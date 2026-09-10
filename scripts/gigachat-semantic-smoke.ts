import { performance } from "node:perf_hooks";
import { z } from "zod";
import { loadLocalEnv } from "@/config/env";
import { evaluateSemanticRule } from "@/semantic-evaluator/evaluator";
import { GigaChatSemanticModelProvider } from "@/semantic-evaluator/providers/gigachat";
import type { SemanticEvaluationInput } from "@/semantic-evaluator/types";

type SmokeCase = {
  name: "clear_pass" | "clear_fail";
  expected: "PASS" | "FAIL";
  input: SemanticEvaluationInput;
};

const model = "GigaChat-3-Pro";
const DEFAULT_SMOKE_PROVIDER_TIMEOUT_MS = 60_000;
const EVALUATOR_TIMEOUT_BUFFER_MS = 5_000;
const semanticOutputSchema = z
  .object({
    status: z.enum(["PASS", "FAIL", "MANUAL_CHECK"]),
    confidence: z.number().min(0).max(1),
    reason_code: z.string().min(1).max(80),
    reason: z.string().min(1).max(1_000),
    evidence_refs: z.array(z.string().min(1))
  })
  .strict();

type SafeProviderDiagnostic = {
  provider_http_success: boolean;
  content_received: boolean;
  content_type?: string;
  json_parse_success: boolean;
  parsed_keys: string[];
  status?: unknown;
  confidence_type?: string;
  reason_code?: unknown;
  evidence_refs?: unknown;
  validator_failure_kind: "NONE" | "SCHEMA_VALIDATION_FAILED" | "EVIDENCE_REF_MISMATCH" | "NO_CONTENT" | "JSON_PARSE_FAILED";
};

let currentAllowedRefs: string[] = [];

const cases: SmokeCase[] = [
  {
    name: "clear_pass",
    expected: "PASS",
    input: {
      ruleId: "PD-008",
      ruleVersion: "0.2-shadow",
      criterion:
        "Determine whether the supplied consent text clearly states at least one concrete purpose for personal-data processing. Return PASS when a concrete purpose is stated, FAIL when consent is requested but no concrete purpose is stated, and MANUAL_CHECK when the excerpt is too fragmented or ambiguous.",
      evidence: [
        {
          ref: "consent_text:synthetic-pass",
          evidenceId: "synthetic-pass",
          evidenceType: "TEXT_FRAGMENT",
          pageUrl: "https://synthetic.example/consent",
          excerpt:
            "Я даю согласие на обработку моих персональных данных для подготовки ответа на мое обращение и обратной связи по заявке.",
          metadata: {
            factType: "consent_text",
            sourceUrl: "https://synthetic.example/consent"
          }
        }
      ],
      context: { siteType: "B2B", synthetic: true }
    }
  },
  {
    name: "clear_fail",
    expected: "FAIL",
    input: {
      ruleId: "PD-008",
      ruleVersion: "0.2-shadow",
      criterion:
        "Determine whether the supplied consent text clearly states at least one concrete purpose for personal-data processing. Return PASS when a concrete purpose is stated, FAIL when consent is requested but no concrete purpose is stated, and MANUAL_CHECK when the excerpt is too fragmented or ambiguous.",
      evidence: [
        {
          ref: "consent_text:synthetic-fail",
          evidenceId: "synthetic-fail",
          evidenceType: "TEXT_FRAGMENT",
          pageUrl: "https://synthetic.example/consent",
          excerpt: "Я даю согласие на обработку моих персональных данных.",
          metadata: {
            factType: "consent_text",
            sourceUrl: "https://synthetic.example/consent"
          }
        }
      ],
      context: { siteType: "B2B", synthetic: true }
    }
  }
];

async function main() {
  loadLocalEnv();

  if (!process.env.GIGACHAT_AUTH_KEY?.trim()) {
    throw new Error("GIGACHAT_AUTH_KEY is not configured");
  }

  let oauthCalls = 0;
  const providerTimeoutMs = numberFromEnv(
    "SEMANTIC_LLM_TIMEOUT_MS",
    numberFromEnv("GIGACHAT_TIMEOUT_MS", DEFAULT_SMOKE_PROVIDER_TIMEOUT_MS)
  );
  const providerMaxRetries = numberFromEnv("GIGACHAT_MAX_RETRIES", 1);
  const evaluatorTimeoutMs = providerTimeoutMs * (providerMaxRetries + 1) + EVALUATOR_TIMEOUT_BUFFER_MS;
  const providerDiagnostics: SafeProviderDiagnostic[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/oauth")) {
      oauthCalls += 1;
    }
    const response = await fetch(input, init);
    if (url.includes("/chat/completions")) {
      providerDiagnostics.push(await captureSafeProviderDiagnostic(response, currentAllowedRefs));
    }
    return response;
  };

  const provider = new GigaChatSemanticModelProvider({
    model,
    fetchImpl,
    timeoutMs: providerTimeoutMs,
    maxRetries: providerMaxRetries
  });

  const results = [];
  for (const item of cases) {
    currentAllowedRefs = item.input.evidence.map((_evidence, index) => `E${index + 1}`);
    const startedAt = performance.now();
    const result = await evaluateSemanticRule(item.input, {
      provider,
      timeoutMs: evaluatorTimeoutMs
    });
    const durationMs = Math.round(performance.now() - startedAt);

    results.push({
      rule: item.input.ruleId,
      case: item.name,
      synthetic_input: item.expected === "PASS" ? "Consent text contains a concrete purpose." : "Consent text omits a concrete purpose.",
      model,
      result_status: result.status,
      confidence: result.status === "NO_EVALUATION" ? undefined : result.confidence,
      reason_code: result.status === "NO_EVALUATION" ? result.technicalErrorCode : result.reasonCode,
      evidence_refs: result.status === "NO_EVALUATION" ? [] : result.evidenceRefs,
      provider_diagnostic: providerDiagnostics.shift() ?? null,
      duration_ms: durationMs,
      technical_error: result.status === "NO_EVALUATION" ? result.technicalErrorCode : null
    });
  }

  console.log(
    JSON.stringify(
      {
        model,
        provider_timeout_ms: providerTimeoutMs,
        evaluator_timeout_ms: evaluatorTimeoutMs,
        oauth_calls: oauthCalls,
        token_reuse_observed: oauthCalls === 1,
        results
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`GigaChat semantic smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});

function numberFromEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function captureSafeProviderDiagnostic(response: Response, allowedRefs: string[]): Promise<SafeProviderDiagnostic> {
  const diagnostic: SafeProviderDiagnostic = {
    provider_http_success: response.ok,
    content_received: false,
    json_parse_success: false,
    parsed_keys: [],
    validator_failure_kind: response.ok ? "NO_CONTENT" : "NONE"
  };

  let transport: unknown;
  try {
    transport = await response.clone().json();
  } catch {
    return diagnostic;
  }

  const content = readContent(transport);
  diagnostic.content_type = typeName(content);
  diagnostic.content_received = typeof content === "string" && content.length > 0;
  if (typeof content !== "string") {
    return diagnostic;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
    diagnostic.json_parse_success = true;
  } catch {
    diagnostic.validator_failure_kind = "JSON_PARSE_FAILED";
    return diagnostic;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostic.validator_failure_kind = "SCHEMA_VALIDATION_FAILED";
    return diagnostic;
  }

  const object = parsed as Record<string, unknown>;
  diagnostic.parsed_keys = Object.keys(object);
  diagnostic.status = object.status;
  diagnostic.confidence_type = typeName(object.confidence);
  diagnostic.reason_code = object.reason_code;
  diagnostic.evidence_refs = object.evidence_refs;

  const validation = semanticOutputSchema.safeParse(object);
  if (!validation.success) {
    diagnostic.validator_failure_kind = "SCHEMA_VALIDATION_FAILED";
    return diagnostic;
  }

  diagnostic.validator_failure_kind = validation.data.evidence_refs.some((ref) => !allowedRefs.includes(ref))
    ? "EVIDENCE_REF_MISMATCH"
    : "NONE";
  return diagnostic;
}

function readContent(transport: unknown): unknown {
  if (!transport || typeof transport !== "object") {
    return undefined;
  }

  const data = transport as Record<string, unknown>;
  const choices = data.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as { message?: { content?: unknown } } | undefined;
    return first?.message?.content;
  }

  const messages = data.messages;
  if (Array.isArray(messages)) {
    const first = messages[0] as { content?: unknown } | undefined;
    if (Array.isArray(first?.content)) {
      const part = first.content[0] as { text?: unknown } | undefined;
      return part?.text;
    }
  }

  return undefined;
}

function typeName(value: unknown): string {
  return Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
}
