import { z } from "zod";
import {
  SEMANTIC_OUTPUT_LIMITS,
  SEMANTIC_OBSERVATIONS,
  type SemanticEvaluation,
  type SemanticEvaluationDiagnostic,
  type SemanticEvaluationInput,
  type SemanticEvaluationResult,
  type SemanticModelProvider,
  type SemanticModelRequest,
  type SemanticNoEvaluation,
  type SemanticSchemaFailureDiagnostic,
  type SemanticSchemaFailureKind,
  type SemanticTechnicalErrorCode
} from "./types";

export const SEMANTIC_EVALUATOR_INSTRUCTIONS = [
  "Analyze only the supplied rule criterion.",
  "Use only the supplied Evidence excerpts and minimal context.",
  "Do not infer facts that are not present in the supplied Evidence.",
  "Do not apply legal knowledge outside the supplied criterion.",
  "Return only whether the required element is PRESENT, ABSENT, or AMBIGUOUS in the supplied Evidence.",
  "PRESENT means the required element is explicitly shown in the supplied Evidence.",
  "ABSENT means the required element is not found or is explicitly absent from the supplied Evidence.",
  "AMBIGUOUS means the supplied Evidence does not allow a reliable presence/absence observation.",
  "Do not decide PASS, FAIL, or MANUAL_CHECK; compliance verdict mapping is handled by deterministic application logic.",
  "Evidence completeness is context only for the observation. Do not convert ABSENT plus PARTIAL, TRUNCATED, or UNKNOWN Evidence into MANUAL_CHECK yourself.",
  "A reference-only statement such as 'see below', 'provided later', or 'described in another section' does not by itself prove the required content is PRESENT.",
  "Return evidence_refs using only refs from the supplied Evidence.",
  "Do not generate legal basis, law text, severity, remediation, rule applicability, or chain-of-thought."
].join("\n");

export interface EvaluateSemanticRuleOptions {
  provider: SemanticModelProvider;
  timeoutMs?: number;
  onDiagnostic?: (diagnostic: SemanticEvaluationDiagnostic) => void;
}

const providerResponseSchema = z
  .object({
    observation: z.enum(SEMANTIC_OBSERVATIONS),
    confidence: z.number().min(SEMANTIC_OUTPUT_LIMITS.confidence.minimum).max(SEMANTIC_OUTPUT_LIMITS.confidence.maximum),
    reason_code: z.string().min(SEMANTIC_OUTPUT_LIMITS.reasonCode.minLength).max(SEMANTIC_OUTPUT_LIMITS.reasonCode.maxLength),
    reason: z.string().min(SEMANTIC_OUTPUT_LIMITS.reason.minLength).max(SEMANTIC_OUTPUT_LIMITS.reason.maxLength),
    evidence_refs: z.array(z.string().min(SEMANTIC_OUTPUT_LIMITS.evidenceRef.minLength))
  })
  .strict();

export async function evaluateSemanticRule(
  input: SemanticEvaluationInput,
  options: EvaluateSemanticRuleOptions
): Promise<SemanticEvaluationResult> {
  const startedAt = Date.now();

  try {
    const rawResponse = await callProviderWithTimeout(
      options.provider,
      toProviderRequest(input),
      options.timeoutMs
    );
    const parsed = parseProviderResponse(rawResponse);

    if (!parsed.ok) {
      const result = noEvaluation("Semantic provider response was not valid JSON.", "MALFORMED_PROVIDER_RESPONSE", {
        kind: "JSON_PARSE_FAILED",
        jsonParseSuccess: false,
        presentFields: [],
        missingRequiredFields: [],
        unexpectedFields: []
      });
      emitDiagnostic(options, input.ruleId, startedAt, "invalid_response", result);
      return result;
    }

    const validation = providerResponseSchema.safeParse(parsed.value);
    if (!validation.success) {
      const result = noEvaluation(
        "Semantic provider response failed schema validation.",
        "SCHEMA_VALIDATION_FAILED",
        schemaFailureDiagnostic(parsed.value, validation.error.issues)
      );
      emitDiagnostic(options, input.ruleId, startedAt, "invalid_response", result);
      return result;
    }

    const allowedRefs = new Set(input.evidence.map((item) => item.ref));
    if (validation.data.evidence_refs.some((ref) => !allowedRefs.has(ref))) {
      const result = noEvaluation("Semantic provider referenced evidence outside the supplied package.", "EVIDENCE_REF_MISMATCH");
      emitDiagnostic(options, input.ruleId, startedAt, "invalid_response", result);
      return result;
    }

    const result = applyRuleSpecificSafetyGuards({
      status: mapObservationToStatus(validation.data.observation, input),
      observation: validation.data.observation,
      confidence: validation.data.confidence,
      reasonCode: validation.data.reason_code,
      reason: validation.data.reason,
      evidenceRefs: validation.data.evidence_refs
    }, input);
    emitDiagnostic(options, input.ruleId, startedAt, "ok", result);
    return result;
  } catch (error) {
    const timeout = error instanceof Error && error.message === "SEMANTIC_PROVIDER_TIMEOUT";
    const result = noEvaluation(
      timeout ? "Semantic provider timed out." : "Semantic provider failed.",
      timeout ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR"
    );
    emitDiagnostic(options, input.ruleId, startedAt, timeout ? "timeout" : "error", result);
    return result;
  }
}

function applyRuleSpecificSafetyGuards(
  result: SemanticEvaluation,
  input: Pick<SemanticEvaluationInput, "ruleId">
): SemanticEvaluation {
  if (
    input.ruleId === "EC-016" &&
    result.status === "PASS" &&
    result.observation === "PRESENT" &&
    ec016ReasonReportsContradiction(result)
  ) {
    return {
      ...result,
      status: "MANUAL_CHECK",
      confidence: Math.min(result.confidence, 0.5),
      reasonCode: "EC016_CONTRADICTION_REASON_REQUIRES_MANUAL_CHECK",
      reason:
        "The provider returned PRESENT for EC-016 while its reason indicated that a return/refund contradiction was found, so PASS was blocked."
    };
  }

  return result;
}

function ec016ReasonReportsContradiction(result: Pick<SemanticEvaluation, "reasonCode" | "reason">): boolean {
  const text = `${result.reasonCode} ${result.reason}`.toLowerCase();
  return [
    /contradiction[_\s-]*(?:present|found|detected)/,
    /explicit\s+contradiction/,
    /contradicts?\s+(?:the\s+)?(?:criterion|rule|requirement|legal)/,
    /противореч[а-яё\s-]*(?:найден|обнаруж|присутств)/
  ].some((pattern) => pattern.test(text));
}

export function mapObservationToStatus(
  observation: SemanticEvaluation["observation"],
  input: Pick<SemanticEvaluationInput, "evidence" | "ruleId">
): SemanticEvaluation["status"] {
  if (input.ruleId === "PD-024") {
    if (observation === "PRESENT" || observation === "AMBIGUOUS") {
      return "MANUAL_CHECK";
    }
    return input.evidence.length > 0 && input.evidence.every((item) => item.completeness === "COMPLETE")
      ? "PASS"
      : "MANUAL_CHECK";
  }

  if (observation === "PRESENT") {
    if (requiresPd019ManualCheck(input)) {
      return "MANUAL_CHECK";
    }
    return hasOnlyReferenceOnlyEvidence(input.evidence) ? "MANUAL_CHECK" : "PASS";
  }

  if (observation === "AMBIGUOUS") {
    return "MANUAL_CHECK";
  }

  return input.evidence.length > 0 && input.evidence.every((item) => item.completeness === "COMPLETE")
    ? "FAIL"
    : "MANUAL_CHECK";
}

function requiresPd019ManualCheck(input: Pick<SemanticEvaluationInput, "evidence" | "ruleId">): boolean {
  if (input.ruleId !== "PD-019") {
    return false;
  }

  const serviceEvidence = input.evidence.filter((item) => item.metadata?.factType === "external_service_matches");
  return (
    serviceEvidence.length > 0 &&
    serviceEvidence.some((item) => item.completeness !== "COMPLETE" || hasUnresolvedServiceRelevance(item.excerpt))
  );
}

function hasUnresolvedServiceRelevance(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    /связ[ьи]\s+с\s+обработк[а-яё\s]*персональных\s+данных\s+не\s+подтвержд/,
    /обработк[а-яё\s]*персональных\s+данных\s+не\s+подтвержд/,
    /релевантност[а-яё\s]*не\s+подтвержд/,
    /possibly|possible|unknown|unconfirmed|not\s+confirmed/
  ].some((pattern) => pattern.test(normalized));
}

function hasOnlyReferenceOnlyEvidence(evidence: SemanticEvaluationInput["evidence"]): boolean {
  return evidence.length > 0 && evidence.every((item) => isReferenceOnlyText(item.excerpt));
}

function isReferenceOnlyText(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    /см\.?\s+(далее|ниже|выше)/,
    /(приведен|приведён|указан|описан|размещен|размещён|опубликован)\s+(далее|ниже|выше|в\s+другом|в\s+отдельном|по\s+ссылке)/,
    /(see|described|provided|available)\s+(below|later|above|in another|in a separate|by link)/
  ].some((pattern) => pattern.test(normalized));
}

function toProviderRequest(input: SemanticEvaluationInput): SemanticModelRequest {
  return {
    instructions: SEMANTIC_EVALUATOR_INSTRUCTIONS,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    criterion: input.criterion,
    evidence: input.evidence,
    facts: input.facts,
    context: input.context
  };
}

async function callProviderWithTimeout(
  provider: SemanticModelProvider,
  request: SemanticModelRequest,
  timeoutMs = 15_000
): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      provider.evaluate(request),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("SEMANTIC_PROVIDER_TIMEOUT")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function parseProviderResponse(rawResponse: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof rawResponse === "string") {
    try {
      return { ok: true, value: JSON.parse(rawResponse) };
    } catch {
      return { ok: false };
    }
  }

  if (rawResponse && typeof rawResponse === "object") {
    return { ok: true, value: rawResponse };
  }

  return { ok: false };
}

function noEvaluation(
  reason: string,
  technicalErrorCode: SemanticTechnicalErrorCode,
  schemaFailure?: SemanticSchemaFailureDiagnostic
): SemanticNoEvaluation {
  return { status: "NO_EVALUATION", reason, technicalErrorCode, schemaFailure };
}

function emitDiagnostic(
  options: EvaluateSemanticRuleOptions,
  ruleId: string,
  startedAt: number,
  providerStatus: SemanticEvaluationDiagnostic["providerStatus"],
  result: SemanticEvaluationResult
): void {
  options.onDiagnostic?.({
    ruleId,
    providerStatus,
    durationMs: Date.now() - startedAt,
    resultStatus: result.status,
    technicalErrorCode: result.status === "NO_EVALUATION" ? result.technicalErrorCode : undefined,
    schemaFailure: result.status === "NO_EVALUATION" ? result.schemaFailure : undefined
  });
}

function schemaFailureDiagnostic(value: unknown, issues: z.ZodIssue[]): SemanticSchemaFailureDiagnostic {
  const missingRequiredFields: string[] = [];
  const unexpectedFields: string[] = [];
  let field: string | undefined;
  let expectedType: string | undefined;
  let actualType: string | undefined;
  let enumExpected: string[] | undefined;
  let enumActual: string | undefined;
  let constraint: string | undefined;
  let limit: number | undefined;
  let kind: SemanticSchemaFailureKind = "OTHER_SCHEMA_FAILURE";

  for (const issue of issues) {
    const path = pathString(issue.path);
    const code = issue.code;
    if (code === "unrecognized_keys") {
      const keys = (issue as z.ZodIssue & { keys?: string[] }).keys ?? [];
      unexpectedFields.push(...keys);
      if (kind === "OTHER_SCHEMA_FAILURE") {
        kind = "EXTRA_FIELD";
      }
      continue;
    }

    if (code === "invalid_type") {
      const expected = String((issue as z.ZodIssue & { expected?: unknown }).expected ?? "unknown");
      const currentActualType = actualTypeAtPath(value, issue.path);
      if (currentActualType === "undefined") {
        missingRequiredFields.push(path);
        if (kind === "OTHER_SCHEMA_FAILURE") {
          kind = "MISSING_FIELD";
        }
      } else if (kind === "OTHER_SCHEMA_FAILURE" || kind === "EXTRA_FIELD") {
        kind = "TYPE_MISMATCH";
        field = path;
        expectedType = expected;
        actualType = currentActualType;
      }
      continue;
    }

    if (code === "too_big" || code === "too_small") {
      if (kind === "OTHER_SCHEMA_FAILURE" || kind === "EXTRA_FIELD") {
        kind = "CONSTRAINT_VIOLATION";
        field = path;
        actualType = actualTypeAtPath(value, issue.path);
        constraint = code === "too_big" ? "max" : "min";
        limit = numericIssueLimit(issue);
      }
      continue;
    }

    if (code === "invalid_value") {
      if (kind === "OTHER_SCHEMA_FAILURE" || kind === "EXTRA_FIELD") {
        kind = "ENUM_MISMATCH";
        field = path;
        expectedType = "enum";
        actualType = actualTypeAtPath(value, issue.path);
        enumExpected = enumValues(issue);
        const actual = valueAtPath(value, issue.path);
        enumActual = typeof actual === "string" ? actual : undefined;
      }
      continue;
    }

    if (!field && path) {
      field = path;
      actualType = actualTypeAtPath(value, issue.path);
    }
  }

  return {
    kind,
    jsonParseSuccess: true,
    presentFields: presentFields(value),
    missingRequiredFields: unique(missingRequiredFields),
    unexpectedFields: unique(unexpectedFields),
    field,
    expectedType,
    actualType,
    enumExpected,
    enumActual,
    constraint,
    limit
  };
}

function presentFields(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>).sort();
}

function pathString(path: PropertyKey[]): string {
  return path.map(String).join(".");
}

function valueAtPath(value: unknown, path: PropertyKey[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function actualTypeAtPath(value: unknown, path: PropertyKey[]): string {
  const target = valueAtPath(value, path);
  if (Array.isArray(target)) {
    return "array";
  }
  if (target === null) {
    return "null";
  }
  return typeof target;
}

function enumValues(issue: z.ZodIssue): string[] | undefined {
  const data = issue as z.ZodIssue & { values?: unknown[]; options?: unknown[] };
  const values = data.values ?? data.options;
  if (!Array.isArray(values)) {
    return undefined;
  }
  return values.filter((value): value is string => typeof value === "string");
}

function numericIssueLimit(issue: z.ZodIssue): number | undefined {
  const data = issue as z.ZodIssue & { maximum?: unknown; minimum?: unknown };
  const value = data.maximum ?? data.minimum;
  return typeof value === "number" ? value : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
