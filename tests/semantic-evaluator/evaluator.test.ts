import { describe, expect, it } from "vitest";
import type { Scan } from "@/db/schema";
import type { Rule } from "@/rule-engine/types";
import { evaluateRulesForScan } from "@/rule-engine/evaluator";
import { evaluateSemanticRule, mapObservationToStatus, SEMANTIC_EVALUATOR_INSTRUCTIONS } from "@/semantic-evaluator/evaluator";
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

function response(observation: "PRESENT" | "ABSENT" | "AMBIGUOUS", confidence = 0.8) {
  return {
    observation,
    confidence,
    reason_code: `${observation}_SYNTHETIC`,
    reason: "Synthetic semantic result.",
    evidence_refs: ["ev:consent-text:1"]
  };
}

function withCompleteness(completeness: SemanticEvaluationInput["evidence"][number]["completeness"]): SemanticEvaluationInput {
  return { ...input, evidence: [{ ...input.evidence[0], completeness }] };
}

describe("generic semantic evaluator", () => {
  it("accepts a valid PRESENT response and maps it to PASS", async () => {
    const provider = new FakeSemanticModelProvider(response("PRESENT", 0.91));

    const result = await evaluateSemanticRule(input, { provider });

    expect(result).toMatchObject({
      status: "PASS",
      observation: "PRESENT",
      confidence: 0.91,
      reasonCode: "PRESENT_SYNTHETIC",
      evidenceRefs: ["ev:consent-text:1"]
    });
    expect(provider.requests[0]).toMatchObject({
      instructions: SEMANTIC_EVALUATOR_INSTRUCTIONS,
      ruleId: "PD-008",
      criterion: input.criterion,
      evidence: input.evidence
    });
  });

  it("accepts a valid ABSENT response and maps COMPLETE evidence to FAIL", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider(response("ABSENT", 0.75))
    });

    expect(result).toMatchObject({ status: "FAIL", observation: "ABSENT", confidence: 0.75 });
  });

  it("accepts a valid AMBIGUOUS response and maps it to MANUAL_CHECK", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider(response("AMBIGUOUS", 0.52))
    });

    expect(result).toMatchObject({ status: "MANUAL_CHECK", observation: "AMBIGUOUS", confidence: 0.52 });
  });

  it("maps PRESENT with COMPLETE evidence to PASS", () => {
    expect(mapObservationToStatus("PRESENT", input)).toBe("PASS");
  });

  it("maps PRESENT with PARTIAL evidence to PASS", () => {
    expect(mapObservationToStatus("PRESENT", withCompleteness("PARTIAL"))).toBe("PASS");
  });

  it("maps ABSENT with COMPLETE evidence to FAIL", () => {
    expect(mapObservationToStatus("ABSENT", input)).toBe("FAIL");
  });

  it("maps ABSENT with PARTIAL evidence to MANUAL_CHECK", () => {
    expect(mapObservationToStatus("ABSENT", withCompleteness("PARTIAL"))).toBe("MANUAL_CHECK");
  });

  it("maps ABSENT with TRUNCATED evidence to MANUAL_CHECK", () => {
    expect(mapObservationToStatus("ABSENT", withCompleteness("TRUNCATED"))).toBe("MANUAL_CHECK");
  });

  it("maps ABSENT with UNKNOWN evidence to MANUAL_CHECK", () => {
    expect(mapObservationToStatus("ABSENT", withCompleteness("UNKNOWN"))).toBe("MANUAL_CHECK");
  });

  it("maps AMBIGUOUS with any completeness to MANUAL_CHECK", () => {
    expect(mapObservationToStatus("AMBIGUOUS", input)).toBe("MANUAL_CHECK");
    expect(mapObservationToStatus("AMBIGUOUS", withCompleteness("PARTIAL"))).toBe("MANUAL_CHECK");
  });

  it("does not let reference-only text count as PRESENT", () => {
    expect(
      mapObservationToStatus("PRESENT", {
        ruleId: input.ruleId,
        evidence: [
          {
            ...input.evidence[0],
            excerpt: "Порядок направления запросов субъектов персональных данных приведен далее."
          }
        ]
      })
    ).toBe("MANUAL_CHECK");
  });

  it("keeps PD-019 PRESENT as MANUAL_CHECK when external-service relevance is unresolved", () => {
    expect(
      mapObservationToStatus("PRESENT", {
        ruleId: "PD-019",
        evidence: [
          {
            ...input.evidence[0],
            ref: "external_service_matches:1",
            excerpt: "Найден внешний сервис, но связь с обработкой персональных данных не подтверждена.",
            completeness: "UNKNOWN",
            metadata: { factType: "external_service_matches" }
          },
          {
            ...input.evidence[0],
            ref: "privacy_policy_text:2",
            excerpt: "Персональные данные третьим лицам не передаются.",
            completeness: "COMPLETE",
            metadata: { factType: "privacy_policy_text" }
          }
        ]
      })
    ).toBe("MANUAL_CHECK");
  });

  it("allows PD-019 PRESENT to PASS when service relevance evidence is complete and resolved", () => {
    expect(
      mapObservationToStatus("PRESENT", {
        ruleId: "PD-019",
        evidence: [
          {
            ...input.evidence[0],
            ref: "external_service_matches:1",
            excerpt: "Найден только технический CDN без признака обработки персональных данных.",
            completeness: "COMPLETE",
            metadata: { factType: "external_service_matches" }
          },
          {
            ...input.evidence[0],
            ref: "privacy_policy_text:2",
            excerpt: "Персональные данные третьим лицам не передаются.",
            completeness: "COMPLETE",
            metadata: { factType: "privacy_policy_text" }
          }
        ]
      })
    ).toBe("PASS");
  });

  it("rejects confidence outside 0..1", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider(response("PRESENT", 1.1))
    });

    expect(result).toMatchObject({
      status: "NO_EVALUATION",
      technicalErrorCode: "SCHEMA_VALIDATION_FAILED"
    });
  });

  it("turns malformed structured objects into SCHEMA_VALIDATION_FAILED", async () => {
    const result = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider({
        observation: "PRESENT",
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
        observation: "MAYBE",
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
        presentFields: ["confidence", "evidence_refs", "extra_field", "observation", "reason"],
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
        observation: "PRESENT",
        confidence: 0.8,
        reason: "Missing reason_code.",
        evidence_refs: ["ev:consent-text:1"]
      })
    });
    const enumMismatch = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider({
        ...response("PRESENT"),
        observation: "MAYBE"
      })
    });
    const typeMismatch = await evaluateSemanticRule(input, {
      provider: new FakeSemanticModelProvider({
        ...response("PRESENT"),
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
    expect(enumMismatch.schemaFailure?.field).toBe("observation");
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
        ...response("PRESENT"),
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
        ...response("PRESENT"),
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
      provider: new FakeSemanticModelProvider(response("PRESENT")),
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
