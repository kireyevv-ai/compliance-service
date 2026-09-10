import { describe, expect, it } from "vitest";
import type { Scan } from "@/db/schema";
import type { Evidence } from "@/evidence/types";
import type { Fact } from "@/facts/types";
import { loadPilotSemanticRuntimeRules, loadRuntimeRules } from "@/legal-rules/runtime";
import { evaluateRulesForScan } from "@/rule-engine/evaluator";
import { FakeSemanticModelProvider } from "@/semantic-evaluator/fake-provider";
import { evaluateSemanticRulesShadow } from "@/semantic-evaluator/shadow";
import type { SemanticModelRequest } from "@/semantic-evaluator/types";

const pilotRuleIds = ["PD-008", "PD-013", "PD-014", "PD-015", "PD-016"] as const;

const scan: Scan = {
  id: "scan-1",
  siteId: "site-1",
  status: "RUNNING",
  statusReason: null,
  siteType: "B2B",
  scannerVersion: "semantic-shadow-test",
  startedAt: new Date("2026-09-10T00:00:00.000Z"),
  finishedAt: null,
  createdAt: new Date("2026-09-10T00:00:00.000Z")
};

function goldenProvider() {
  return new FakeSemanticModelProvider((request: SemanticModelRequest) => {
    const text = request.evidence.map((item) => item.excerpt).join("\n");
    const evidenceRefs = request.evidence.map((item) => item.ref);

    if (text.includes("GOLDEN_PASS")) {
      return semanticResponse("PASS", evidenceRefs);
    }

    if (text.includes("GOLDEN_FAIL")) {
      return semanticResponse("FAIL", evidenceRefs);
    }

    return semanticResponse("MANUAL_CHECK", evidenceRefs, "AMBIGUOUS_SYNTHETIC");
  });
}

function semanticResponse(status: "PASS" | "FAIL" | "MANUAL_CHECK", evidenceRefs: string[], reasonCode = `${status}_SYNTHETIC`) {
  return {
    status,
    confidence: status === "MANUAL_CHECK" ? 0.45 : 0.86,
    reason_code: reasonCode,
    reason: "Synthetic golden semantic result.",
    evidence_refs: evidenceRefs
  };
}

function semanticFixture(ruleId: (typeof pilotRuleIds)[number], marker: "GOLDEN_PASS" | "GOLDEN_FAIL" | "GOLDEN_MANUAL") {
  const factType = ruleId === "PD-008" ? "consent_text" : "privacy_policy_text";
  const text =
    ruleId === "PD-008"
      ? `${marker}: согласие на обработку персональных данных рядом с формой.`
      : `${marker}: политика обработки персональных данных, содержательный текст документа.`;
  const fact: Fact = {
    id: `fact-${ruleId}`,
    scanId: scan.id,
    pageUrl: "https://example.test/privacy",
    factType,
    value: {
      text,
      sourceUrl: "https://example.test/privacy",
      truncated: false,
      originalTextLength: text.length,
      maxChars: 50_000
    },
    createdAt: new Date("2026-09-10T00:00:00.000Z")
  };
  const evidence: Evidence = {
    id: `evidence-${ruleId}`,
    scanId: scan.id,
    factId: fact.id,
    evidenceType: "TEXT_FRAGMENT",
    pageUrl: "https://example.test/privacy",
    payload: {
      kind: factType,
      text,
      context: text,
      sourceUrl: "https://example.test/privacy",
      truncated: false,
      originalTextLength: text.length,
      maxChars: 50_000
    },
    createdAt: new Date("2026-09-10T00:00:00.000Z")
  };

  return { fact, evidence };
}

function ruleOnly(ruleId: string) {
  return loadPilotSemanticRuntimeRules().filter((rule) => rule.ruleId === ruleId);
}

describe("pilot semantic rules shadow mode", () => {
  it.each(pilotRuleIds)("loads %s as an LLM_SEMANTIC runtime rule", (ruleId) => {
    const [rule] = ruleOnly(ruleId);

    expect(rule).toMatchObject({
      ruleId,
      evaluatorType: "LLM_SEMANTIC",
      evaluation: expect.objectContaining({
        kind: "SEMANTIC_CRITERION",
        criterion: expect.any(String)
      })
    });
  });

  it.each(
    pilotRuleIds.flatMap((ruleId) => [
      [ruleId, "GOLDEN_PASS", "PASS"],
      [ruleId, "GOLDEN_FAIL", "FAIL"],
      [ruleId, "GOLDEN_MANUAL", "MANUAL_CHECK"]
    ] as const)
  )("%s returns %s for %s golden evidence", async (ruleId, marker, expectedStatus) => {
    const { fact, evidence } = semanticFixture(ruleId, marker);

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [fact],
      evidence: [evidence],
      rules: ruleOnly(ruleId),
      provider: goldenProvider()
    });

    expect(result).toMatchObject({
      ruleId,
      status: expectedStatus
    });
    expect(result.evidenceRefs).toEqual([`${fact.factType}:${evidence.id}`]);
  });

  it("builds scoped evidence packages and does not pass unrelated evidence", async () => {
    const provider = goldenProvider();
    const consent = semanticFixture("PD-008", "GOLDEN_PASS");
    const policy = semanticFixture("PD-013", "GOLDEN_PASS");

    await evaluateSemanticRulesShadow({
      scan,
      facts: [consent.fact, policy.fact],
      evidence: [consent.evidence, policy.evidence],
      rules: ruleOnly("PD-008"),
      provider
    });

    expect(provider.requests[0].evidence).toHaveLength(1);
    expect(provider.requests[0].evidence[0]).toMatchObject({
      ref: `consent_text:${consent.evidence.id}`,
      excerpt: expect.stringContaining("GOLDEN_PASS")
    });
  });

  it("turns provider failure into shadow NO_EVALUATION", async () => {
    const { fact, evidence } = semanticFixture("PD-013", "GOLDEN_PASS");

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [fact],
      evidence: [evidence],
      rules: ruleOnly("PD-013"),
      provider: new FakeSemanticModelProvider(() => {
        throw new Error("provider unavailable");
      })
    });

    expect(result).toMatchObject({
      ruleId: "PD-013",
      status: "NO_EVALUATION",
      result: expect.objectContaining({
        technicalErrorCode: "PROVIDER_ERROR"
      })
    });
  });

  it("does not allow truncated policy evidence to produce shadow FAIL", async () => {
    const { fact, evidence } = semanticFixture("PD-013", "GOLDEN_FAIL");
    fact.value.truncated = true;
    evidence.payload = { ...evidence.payload, truncated: true };

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [fact],
      evidence: [evidence],
      rules: ruleOnly("PD-013"),
      provider: goldenProvider()
    });

    expect(result).toMatchObject({
      status: "MANUAL_CHECK",
      result: expect.objectContaining({
        reasonCode: "TRUNCATED_POLICY_REQUIRES_MANUAL_CHECK"
      })
    });
  });

  it("keeps deterministic evaluation separate from semantic shadow mode", async () => {
    const deterministicEvaluations = evaluateRulesForScan({
      scan,
      rules: loadRuntimeRules(),
      facts: [
        factForDeterministic("scan_coverage", { crawlCompleted: true, contentLimited: false, successfulHtmlPages: 1, httpErrorPages: 0 }),
        factForDeterministic("personal_data_collection_found", { found: true }),
        factForDeterministic("privacy_policy_link_found", { found: true })
      ],
      evidence: []
    });
    const shadowResults = await evaluateSemanticRulesShadow({
      scan,
      facts: [],
      evidence: [],
      provider: new FakeSemanticModelProvider(() => {
        throw new Error("semantic provider should not be needed without semantic evidence");
      })
    });

    expect(deterministicEvaluations.find((item) => item.ruleId === "PD-001")?.status).toBe("PASS");
    expect(shadowResults.some((item) => item.ruleId === "PD-001")).toBe(false);
  });
});

function factForDeterministic(factType: string, value: Record<string, unknown>): Fact {
  return {
    id: `fact-${factType}`,
    scanId: scan.id,
    factType,
    value,
    createdAt: new Date("2026-09-10T00:00:00.000Z")
  };
}
