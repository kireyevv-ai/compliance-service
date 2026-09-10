import { describe, expect, it } from "vitest";
import { GigaChatSemanticModelProvider } from "@/semantic-evaluator/providers/gigachat";
import type { SemanticModelRequest } from "@/semantic-evaluator/types";

const request: SemanticModelRequest = {
  instructions: "Use only supplied evidence.",
  ruleId: "PD-013",
  ruleVersion: "0.2-shadow",
  criterion: "Check policy purposes.",
  evidence: [
    {
      ref: "privacy_policy_text:evidence-1",
      evidenceId: "evidence-1",
      evidenceType: "TEXT_FRAGMENT",
      pageUrl: "https://example.test/privacy",
      excerpt: "RAW_EVIDENCE_SHOULD_ONLY_BE_IN_REQUEST_BODY",
      metadata: {
        factType: "privacy_policy_text"
      }
    }
  ],
  context: { siteType: "B2B" }
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function provider(fetchImpl: typeof fetch, now = () => 1_000_000) {
  return new GigaChatSemanticModelProvider({
    authKey: "test-auth-key",
    scope: "GIGACHAT_API_PERS",
    model: "GigaChat-Test",
    fetchImpl,
    now,
    backoffMs: 0,
    maxRetries: 1
  });
}

function oauthResponse(expiresAt: number) {
  return jsonResponse({ access_token: `token-${expiresAt}`, expires_at: expiresAt });
}

function chatResponse(status: "PASS" | "FAIL" | "MANUAL_CHECK" = "PASS") {
  return jsonResponse({
    choices: [
      {
        message: {
          content: JSON.stringify({
            status,
            confidence: 0.88,
            reason_code: `${status}_SYNTHETIC`,
            reason: "Synthetic structured response.",
            evidence_refs: ["E1"]
          })
        }
      }
    ]
  });
}

describe("GigaChat semantic provider", () => {
  it("acquires an OAuth token using Authorization Key and scope", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return calls.length === 1 ? oauthResponse(9_999_999_999_999) : chatResponse();
    }) as typeof fetch;

    await provider(fetchImpl).evaluate(request);

    expect(calls[0].url).toBe("https://ngw.devices.sberbank.ru:9443/api/v2/oauth");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Basic test-auth-key",
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    });
    expect(calls[0].init.body).toBe("scope=GIGACHAT_API_PERS");
    expect(calls[1].init.headers).toMatchObject({
      Authorization: "Bearer token-9999999999999"
    });
  });

  it("reuses cached token until expiry", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return calls.length === 1 ? oauthResponse(9_999_999_999_999) : chatResponse();
    }) as typeof fetch;
    const client = provider(fetchImpl);

    await client.evaluate(request);
    await client.evaluate(request);

    expect(calls.filter((url) => url.includes("/oauth"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/chat/completions"))).toHaveLength(2);
  });

  it("refreshes token after expiry", async () => {
    let now = 1_000_000_000_000;
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes("/oauth")) {
        return oauthResponse(now + 120_000);
      }
      return chatResponse();
    }) as typeof fetch;
    const client = provider(fetchImpl, () => now);

    await client.evaluate(request);
    now += 120_000;
    await client.evaluate(request);

    expect(calls.filter((url) => url.includes("/oauth"))).toHaveLength(2);
  });

  it("parses model list without exposing token data", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("/oauth")) {
        return oauthResponse(9_999_999_999_999);
      }
      return jsonResponse({ data: [{ id: "GigaChat-2" }, { id: "GigaChat-2-Pro" }] });
    }) as typeof fetch;

    const models = await provider(fetchImpl).listModels();

    expect(models).toEqual([{ id: "GigaChat-2" }, { id: "GigaChat-2-Pro" }]);
  });

  it("returns parsed structured semantic response", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      return String(url).includes("/oauth") ? oauthResponse(9_999_999_999_999) : chatResponse("FAIL");
    }) as typeof fetch;

    const result = await provider(fetchImpl).evaluate(request);

    expect(result).toMatchObject({
      status: "FAIL",
      confidence: 0.88,
      evidence_refs: ["privacy_policy_text:evidence-1"]
    });
  });

  it("retries transient 429 and 5xx provider errors", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes("/oauth")) {
        return oauthResponse(9_999_999_999_999);
      }
      return calls.filter((call) => call.includes("/chat/completions")).length === 1
        ? jsonResponse({ error: "rate limited" }, 429)
        : chatResponse("PASS");
    }) as typeof fetch;

    const result = await provider(fetchImpl).evaluate(request);

    expect(result).toMatchObject({ status: "PASS" });
    expect(calls.filter((url) => url.includes("/chat/completions"))).toHaveLength(2);
  });

  it("retries transient 5xx provider errors", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes("/oauth")) {
        return oauthResponse(9_999_999_999_999);
      }
      return calls.filter((call) => call.includes("/chat/completions")).length === 1
        ? jsonResponse({ error: "temporary unavailable" }, 503)
        : chatResponse("PASS");
    }) as typeof fetch;

    const result = await provider(fetchImpl).evaluate(request);

    expect(result).toMatchObject({ status: "PASS" });
    expect(calls.filter((url) => url.includes("/chat/completions"))).toHaveLength(2);
  });

  it("surfaces auth/provider failures without credentials or raw evidence in the error message", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "unauthorized" }, 401)) as typeof fetch;

    await expect(provider(fetchImpl).evaluate(request)).rejects.toThrow(/HTTP 401/);
    await expect(provider(fetchImpl).evaluate(request)).rejects.not.toThrow(/test-auth-key/);
    await expect(provider(fetchImpl).evaluate(request)).rejects.not.toThrow(/RAW_EVIDENCE/);
  });

  it("sends structured response format without logging raw response bodies", async () => {
    let chatBody = "";
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/oauth")) {
        return oauthResponse(9_999_999_999_999);
      }
      chatBody = String(init?.body ?? "");
      return chatResponse("MANUAL_CHECK");
    }) as typeof fetch;

    await provider(fetchImpl).evaluate(request);

    expect(chatBody).toContain('"response_format"');
    expect(chatBody).toContain('"json_schema"');
    expect(chatBody).toContain('"strict":true');
    expect(chatBody).toContain("Use only supplied evidence.");
    expect(chatBody).toContain("RAW_EVIDENCE_SHOULD_ONLY_BE_IN_REQUEST_BODY");
    const body = JSON.parse(chatBody);
    const userContent = JSON.parse(body.messages[1].content);
    expect(userContent.evidence[0].ref).toBe("E1");
    expect(chatBody).not.toContain("privacy_policy_text:evidence-1");
  });

  it("applies custom semantic LLM timeout to provider requests", async () => {
    const previousTimeout = process.env.SEMANTIC_LLM_TIMEOUT_MS;
    process.env.SEMANTIC_LLM_TIMEOUT_MS = "5";
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/oauth")) {
        return oauthResponse(9_999_999_999_999);
      }

      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted by configured timeout")));
      });
    }) as typeof fetch;

    try {
      await expect(provider(fetchImpl).evaluate(request)).rejects.toThrow("GigaChat provider request failed");
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.SEMANTIC_LLM_TIMEOUT_MS;
      } else {
        process.env.SEMANTIC_LLM_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  it("maps one model-facing evidence alias back to the internal ref", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      return String(url).includes("/oauth") ? oauthResponse(9_999_999_999_999) : chatResponse("PASS");
    }) as typeof fetch;

    const result = await provider(fetchImpl).evaluate(request);

    expect(result).toMatchObject({
      status: "PASS",
      evidence_refs: ["privacy_policy_text:evidence-1"]
    });
  });

  it("maps multiple model-facing evidence aliases back to internal refs", async () => {
    const multiEvidenceRequest: SemanticModelRequest = {
      ...request,
      evidence: [
        request.evidence[0],
        {
          ...request.evidence[0],
          ref: "privacy_policy_text:evidence-2",
          evidenceId: "evidence-2",
          excerpt: "Second synthetic excerpt."
        }
      ]
    };
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/oauth")) {
        return oauthResponse(9_999_999_999_999);
      }

      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body.messages[1].content).toContain('"ref":"E1"');
      expect(body.messages[1].content).toContain('"ref":"E2"');
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: "PASS",
                confidence: 0.9,
                reason_code: "PASS_SYNTHETIC",
                reason: "Synthetic structured response.",
                evidence_refs: ["E1", "E2"]
              })
            }
          }
        ]
      });
    }) as typeof fetch;

    const result = await provider(fetchImpl).evaluate(multiEvidenceRequest);

    expect(result).toMatchObject({
      evidence_refs: ["privacy_policy_text:evidence-1", "privacy_policy_text:evidence-2"]
    });
  });

  it("keeps unknown model-facing aliases invalid instead of guessing refs", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("/oauth")) {
        return oauthResponse(9_999_999_999_999);
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: "PASS",
                confidence: 0.9,
                reason_code: "PASS_SYNTHETIC",
                reason: "Synthetic structured response.",
                evidence_refs: ["E9"]
              })
            }
          }
        ]
      });
    }) as typeof fetch;

    const result = await provider(fetchImpl).evaluate(request);

    expect(result).toMatchObject({
      evidence_refs: ["__UNKNOWN_EVIDENCE_ALIAS__:E9"]
    });
  });

  it("limits dynamic structured schema evidence refs to supplied aliases", async () => {
    let schema: { properties?: { evidence_refs?: { items?: unknown } } } = {};
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/oauth")) {
        return oauthResponse(9_999_999_999_999);
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      schema = body.response_format.schema;
      return chatResponse("PASS");
    }) as typeof fetch;

    await provider(fetchImpl).evaluate(request);

    expect(schema.properties?.evidence_refs?.items).toEqual({
      type: "string",
      enum: ["E1"]
    });
  });

  it("does not leak benchmark expected verdict or case label into provider semantic request", async () => {
    let chatBody = "";
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/oauth")) {
        return oauthResponse(9_999_999_999_999);
      }
      chatBody = String(init?.body ?? "");
      return chatResponse("PASS");
    }) as typeof fetch;

    await provider(fetchImpl).evaluate(request);

    expect(chatBody).not.toContain("clear_pass");
    expect(chatBody).not.toContain("clear_fail");
    expect(chatBody).not.toContain('"expected"');
    expect(chatBody).not.toContain('"expectedStatus"');
  });
});
