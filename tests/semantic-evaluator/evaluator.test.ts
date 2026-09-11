import { describe, expect, it } from "vitest";
import type { Scan } from "@/db/schema";
import type { Rule } from "@/rule-engine/types";
import { evaluateRulesForScan } from "@/rule-engine/evaluator";
import { evaluateSemanticRule, SEMANTIC_EVALUATOR_INSTRUCTIONS } from "@/semantic-evaluator/evaluator";
import { FakeSemanticModelProvider } from "@/semantic-evaluator/fake-provider";
import { SEMANTIC_OUTPUT_LIMITS } from "@/semantic-evaluator/types";
import type { SemanticEvaluationInput, SemanticModelProvider } from "@/semantic-evaluator/types";

const input: SemanticEvaluationInput = {
  ruleId: "PD-008",
  ruleVersion: "1",
  criterion: "Determine whether the supplied consent text states a concrete processing purpose.",
  evidence: [
    {
      ref: "ev:consent-text:1",
      evidenceId: "00000000-0000-4000-8000-000000000201",
      evidenceType: "TEXT_FRAGMENT",
      pageUrl: "https://example.test/form",
      excerpt: "Согласие на обработку персональных данных для обработки заявки.",
      completeness: "COMPLETE"
    }
  ],
  context: { siteType: "B2B" }
};

function response(status: "PASS" | "FAIL" | "MANUAL_CHECK", confidence = 0.8) {
  return {
    status,
    confidence,
    reason_code: `${status}_SYNTHETIC`,
    reason: "Synthetic semantic result.",
    evidence_refs: ["ev:consent-text:1"]
  };
}

describe("generic semantic evaluator", () => {
  it("accepts a valid PASS response", async () => {
    const provider = new FakeSemanticModelProvider(response("PASS", 0.91));

    const result = await evaluateSemanticRule(input, { provider });

    expect(result).toMatchObject({
      status: "PASS",
      confidence: 0.91,
      reasonCode: "PASS_SYNTHETIC",
      evidenceRefs: ["ev:consent-text:1"]
    });
    expect(provider.requests[0]).toMatchObject({
      instructions: SEMANTIC_EVALUATOR_INSTRUCTIONS,
      ruleId: "PD-008",
      criterion: input.criterion,
      evidence: input.evidence
    });
  });

  it("accepts a valid FAIL response", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider(response("FAIL", 0.75))
    });

    expect(result).toMatchObject({ status: "FAIL", confidence: 0.75 });
  });

  it("accepts a valid MANUAL_CHECK response", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider(response("MANUAL_CHECK", 0.52))
    });

    expect(result).toMatchObject({ status: "MANUAL_CHECK", confidence: 0.52 });
  });

  it("rejects confidence outside 0..1", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider(response("PASS", 1.1))
    });

    expect(result).toMatchObject({
      status: "NO_EVALUATION",
      technicalErrorCode: "SCHEMA_VALIDATION_FAILED"
    });
  });

  it("turns malformed structured objects into SCHEMA_VALIDATION_FAILED", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider({
        status: "PASS",
        confidence: 0.8,
        reason: "Missing reason_code.",
        evidence_refs: ["ev:consent-text:1"]
      })
    });

    expect(result).toMatchObject({
      status: "NO_EVALUATION",
      technicalErrorCode: "SCHEMA_VALIDATION_FAILED"
    });
  });

  it("adds safe schema failure diagnostics without raw reason or evidence text", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider({
        status: "MAYBE",
        confidence: "high",
        reason: "raw reason should stay out of diagnostics",
        evidence_refs: ["ev:consent-text:1"],
        extra_field: "unexpected"
      })
    });

    expect(result).toMatchObject({
      status: "NO_EVALUATION",
      technicalErrorCode: "SCHEMA_VALIDATION_FAILED",
      schemaFailure: {
        jsonParseSuccess: true,
        presentFields: ["confidence", "evidence_refs", "extra_field", "reason", "status"],
        unexpectedFields: ["extra_field"]
      }
    });
    if (result.status !== "NO_EVALUATION") {
      throw new Error("Expected NO_EVALUATION");
    }
    expect(result.schemaFailure?.kind).toMatch(/EXTRA_FIELD|TYPE_MISMATCH|ENUM_MISMATCH/);
    expect(JSON.stringify(result.schemaFailure)).not.toContain("raw reason should stay out");
    expect(JSON.stringify(result.schemaFailure)).not.toContain(input.evidence[0].excerpt);
  });

  it("classifies missing field, enum mismatch, type mismatch, and JSON parse failures", async () => {
    const missing = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider({
        status: "PASS",
        confidence: 0.8,
        reason: "Missing reason_code.",
        evidence_refs: ["ev:consent-text:1"]
      })
    });
    const enumMismatch = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider({
        ...response("PASS"),
        status: "MAYBE"
      })
    });
    const typeMismatch = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider({
        ...response("PASS"),
        confidence: "0.8"
      })
    });
    const parseFailed = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider("{not valid json")
    });

    expect(missing.status).toBe("NO_EVALUATION");
    if (missing.status !== "NO_EVALUATION") {
      throw new Error("Expected missing-field case to return NO_EVALUATION");
    }
    expect(missing.schemaFailure?.kind).toBe("MISSING_FIELD");
    expect(missing.schemaFailure?.missingRequiredFields).toEqual(["reason_code"]);
    expect(enumMismatch.status).toBe("NO_EVALUATION");
    if (enumMismatch.status !== "NO_EVALUATION") {
      throw new Error("Expected enum mismatch case to return NO_EVALUATION");
    }
    expect(enumMismatch.schemaFailure?.kind).toBe("ENUM_MISMATCH");
    expect(enumMismatch.schemaFailure?.field).toBe("status");
    expect(typeMismatch.status).toBe("NO_EVALUATION");
    if (typeMismatch.status !== "NO_EVALUATION") {
      throw new Error("Expected type mismatch case to return NO_EVALUATION");
    }
    expect(typeMismatch.schemaFailure?.kind).toBe("TYPE_MISMATCH");
    expect(typeMismatch.schemaFailure?.field).toBe("confidence");
    expect(parseFailed.status).toBe("NO_EVALUATION");
    if (parseFailed.status !== "NO_EVALUATION") {
      throw new Error("Expected parse failure case to return NO_EVALUATION");
    }
    expect(parseFailed.schemaFailure?.kind).toBe("JSON_PARSE_FAILED");
    expect(parseFailed.schemaFailure?.jsonParseSuccess).toBe(false);
  });

  it("rejects overlong reason_code as a constraint violation without silent truncation", async () => {
    const overlongReasonCode = "X".repeat(SEMANTIC_OUTPUT_LIMITS.reasonCode.maxLength + 1);
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider({
        ...response("PASS"),
        reason_code: overlongReasonCode
      })
    });

    expect(result).toMatchObject({
      status: "NO_EVALUATION",
      technicalErrorCode: "SCHEMA_VALIDATION_FAILED",
      schemaFailure: {
        kind: "CONSTRAINT_VIOLATION",
        field: "reason_code",
        actualType: "string",
        constraint: "max",
        limit: SEMANTIC_OUTPUT_LIMITS.reasonCode.maxLength
      }
    });
    if (result.status !== "NO_EVALUATION") {
      throw new Error("Expected overlong reason_code to return NO_EVALUATION");
    }
    expect(JSON.stringify(result.schemaFailure)).not.toContain(overlongReasonCode);
  });

  it("separates structurally valid responses with invented evidence refs from schema failures", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider({
        ...response("PASS"),
        evidence_refs: ["ev:consent-text:1", "ev:invented"]
      })
    });

    expect(result).toMatchObject({
      status: "NO_EVALUATION",
      technicalErrorCode: "EVIDENCE_REF_MISMATCH"
    });
  });

  it("turns malformed provider responses into NO_EVALUATION", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider("{not valid json")
    });

    expect(result).toMatchObject({
      status: "NO_EVALUATION",
      technicalErrorCode: "MALFORMED_PROVIDER_RESPONSE"
    });
  });

  it("turns provider exceptions into NO_EVALUATION", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider(() => {
        throw new Error("provider unavailable");
      })
    });

    expect(result).toMatchObject({
      status: "NO_EVALUATION",
      technicalErrorCode: "PROVIDER_ERROR"
    });
  });

  it("turns provider timeout into NO_EVALUATION", async () => {
    const neverProvider: SemanticModelProvider = {
      async evaluate() {
        return new Promise(() => undefined);
      }
    };

    const result = await evaluateSemanticRule(input, {
      provider: neverProvider,
      timeoutMs: 1
    });

    expect(result).toMatchObject({
      status: "NO_EVALUATION",
      technicalErrorCode: "PROVIDER_TIMEOUT"
    });
  });

  it("emits diagnostics without raw evidence text", async () => {
    const diagnostics: unknown[] = [];

    await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider(response("PASS")),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    });

    expect(JSON.stringify(diagnostics)).toContain("PD-008");
    expect(JSON.stringify(diagnostics)).not.toContain(input.evidence[0].excerpt);
  });

  it("does not route deterministic rules through the semantic evaluator", () => {
    const scan: Scan = {
      id: "00000000-0000-4000-8000-000000000301",
      siteId: "00000000-0000-4000-8000-000000000302",
      status: "RUNNING",
      statusReason: null,
      siteType: "B2B",
      scannerVersion: "semantic-test",
      startedAt: new Date(),
      finishedAt: null,
      createdAt: new Date()
    };
    const rule: Rule = {
      ruleId: "PD-001",
      version: "1",
      title: "Synthetic PD-001",
      passSummary: "Synthetic pass.",
      module: "PERSONAL_DATA",
      evaluatorType: "DETERMINISTIC",
      legalStrength: "MANDATORY",
      statusIfTriggered: "FAIL",
      appliesTo: ["B2B"],
      requiredFacts: ["scan_coverage", "personal_data_collection_found", "privacy_policy_link_found"],
      evidenceRequirements: [],
      legalBasis: [],
      severity: "HIGH",
      evaluation: { kind: "FACT_PATTERN", conditions: { builtin: "PD-001" } },
      remediation: "Synthetic remediation.",
      confidencePolicy: { fixed_confidence: 0.9 },
      limitations: [],
      effectiveFrom: "2026-09-10",
      lastVerifiedAt: "2026-09-10"
    };

    const evaluations = evaluateRulesForScan({
      scan,
      rules: [rule],
      facts: [
        {
          id: "00000000-0000-4000-8000-000000000303",
          scanId: scan.id,
          factType: "scan_coverage",
          value: { crawlCompleted: true, contentLimited: false },
          createdAt: new Date()
        },
        {
          id: "00000000-0000-4000-8000-000000000304",
          scanId: scan.id,
          factType: "personal_data_collection_found",
          value: { found: true },
          createdAt: new Date()
        },
        {
          id: "00000000-0000-4000-8000-000000000305",
          scanId: scan.id,
          factType: "privacy_policy_link_found",
          value: { found: true },
          createdAt: new Date()
        }
      ],
      evidence: []
    });

    expect(evaluations).toHaveLength(1);
    expect(evaluations[0].status).toBe("PASS");
  });
});
