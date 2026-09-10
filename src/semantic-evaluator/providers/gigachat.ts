import { randomUUID } from "node:crypto";
import type { SemanticModelProvider, SemanticModelRequest } from "../types";

type Fetch = typeof fetch;

export interface GigaChatProviderOptions {
  authKey?: string;
  scope?: string;
  model?: string;
  apiBaseUrl?: string;
  oauthUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: Fetch;
  now?: () => number;
  backoffMs?: number;
}

export interface GigaChatModel {
  id: string;
}

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

const DEFAULT_API_BASE_URL = "https://api.giga.chat";
const DEFAULT_OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const DEFAULT_SCOPE = "GIGACHAT_API_PERS";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 1;
const TOKEN_REFRESH_SKEW_MS = 60_000;

const semanticResponseSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["PASS", "FAIL", "MANUAL_CHECK"]
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    reason_code: {
      type: "string"
    },
    reason: {
      type: "string"
    },
    evidence_refs: {
      type: "array",
      items: {
        type: "string"
      }
    }
  },
  required: ["status", "confidence", "reason_code", "reason", "evidence_refs"],
  additionalProperties: false
};

export class GigaChatSemanticModelProvider implements SemanticModelProvider {
  private readonly authKey: string;
  private readonly scope: string;
  private readonly model?: string;
  private readonly apiBaseUrl: string;
  private readonly oauthUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: Fetch;
  private readonly now: () => number;
  private readonly backoffMs: number;
  private cachedToken?: CachedToken;

  constructor(options: GigaChatProviderOptions = {}) {
    const authKey = options.authKey ?? process.env.GIGACHAT_AUTH_KEY;
    if (!authKey) {
      throw new Error("GIGACHAT_AUTH_KEY is required");
    }

    this.authKey = authKey;
    this.scope = options.scope ?? process.env.GIGACHAT_SCOPE ?? DEFAULT_SCOPE;
    this.model = options.model ?? process.env.GIGACHAT_MODEL;
    this.apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? process.env.GIGACHAT_API_BASE_URL ?? DEFAULT_API_BASE_URL);
    this.oauthUrl = options.oauthUrl ?? process.env.GIGACHAT_OAUTH_URL ?? DEFAULT_OAUTH_URL;
    this.timeoutMs = options.timeoutMs ?? numberFromEnv("GIGACHAT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    this.maxRetries = options.maxRetries ?? numberFromEnv("GIGACHAT_MAX_RETRIES", DEFAULT_MAX_RETRIES);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.backoffMs = options.backoffMs ?? 250;
  }

  async evaluate(request: SemanticModelRequest): Promise<unknown> {
    if (!this.model) {
      throw new Error("GIGACHAT_MODEL is required for semantic evaluation");
    }

    const response = await this.fetchJsonWithRetries(`${this.apiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        messages: toMessages(request),
        response_format: {
          type: "json_schema",
          schema: semanticResponseSchema,
          strict: true
        }
      })
    });

    return parseChatCompletionContent(response);
  }

  async listModels(): Promise<GigaChatModel[]> {
    const response = await this.fetchJsonWithRetries(`${this.apiBaseUrl}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        Accept: "application/json"
      }
    });

    return parseModelsResponse(response);
  }

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAtMs - TOKEN_REFRESH_SKEW_MS > this.now()) {
      return this.cachedToken.accessToken;
    }

    const body = new URLSearchParams({ scope: this.scope });
    const response = await this.fetchJson(this.oauthUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.authKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        RqUID: randomUUID()
      },
      body: body.toString()
    });

    const token = parseTokenResponse(response);
    this.cachedToken = token;
    return token.accessToken;
  }

  private async fetchJsonWithRetries(url: string, init: RequestInit): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.fetchJson(url, init);
      } catch (error) {
        lastError = error;
        if (!isTransientError(error) || attempt >= this.maxRetries) {
          throw error;
        }
        await sleep(this.backoffMs * (attempt + 1));
      }
    }

    throw lastError;
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new GigaChatProviderError(response.status);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof GigaChatProviderError) {
        throw error;
      }
      throw new GigaChatProviderError(undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

class GigaChatProviderError extends Error {
  constructor(
    public readonly status?: number,
    public readonly cause?: unknown
  ) {
    super(status ? `GigaChat provider returned HTTP ${status}` : "GigaChat provider request failed");
  }
}

function toMessages(request: SemanticModelRequest) {
  return [
    {
      role: "system",
      content: request.instructions
    },
    {
      role: "user",
      content: JSON.stringify({
        rule_id: request.ruleId,
        rule_version: request.ruleVersion,
        criterion: request.criterion,
        evidence: request.evidence,
        facts: request.facts,
        context: request.context
      })
    }
  ];
}

function parseTokenResponse(response: unknown): CachedToken {
  if (!response || typeof response !== "object") {
    throw new GigaChatProviderError();
  }

  const data = response as Record<string, unknown>;
  if (typeof data.access_token !== "string" || typeof data.expires_at !== "number") {
    throw new GigaChatProviderError();
  }

  const expiresAtMs = data.expires_at > 10_000_000_000 ? data.expires_at : data.expires_at * 1_000;
  return { accessToken: data.access_token, expiresAtMs };
}

function parseModelsResponse(response: unknown): GigaChatModel[] {
  if (!response || typeof response !== "object") {
    throw new GigaChatProviderError();
  }

  const data = response as { data?: unknown; models?: unknown };
  const rawModels = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  return rawModels
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const model = item as Record<string, unknown>;
      const id = typeof model.id === "string" ? model.id : typeof model.name === "string" ? model.name : undefined;
      return id ? { id } : undefined;
    })
    .filter((item): item is GigaChatModel => Boolean(item));
}

function parseChatCompletionContent(response: unknown): unknown {
  const content = readChatCompletionContent(response);
  if (!content) {
    throw new GigaChatProviderError();
  }

  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function readChatCompletionContent(response: unknown): string | undefined {
  if (!response || typeof response !== "object") {
    return undefined;
  }

  const data = response as Record<string, unknown>;
  const choices = data.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as { message?: { content?: unknown } } | undefined;
    return typeof first?.message?.content === "string" ? first.message.content : undefined;
  }

  const messages = data.messages;
  if (Array.isArray(messages)) {
    const first = messages[0] as { content?: unknown } | undefined;
    if (Array.isArray(first?.content)) {
      const part = first.content[0] as { text?: unknown } | undefined;
      return typeof part?.text === "string" ? part.text : undefined;
    }
  }

  return undefined;
}

function isTransientError(error: unknown): boolean {
  if (!(error instanceof GigaChatProviderError)) {
    return false;
  }
  return error.status === undefined || error.status === 429 || (error.status >= 500 && error.status <= 599);
}

function numberFromEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
