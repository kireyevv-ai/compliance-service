import { z } from "zod";
import {
  SEMANTIC_EVALUATION_STATUSES,
  type SemanticEvaluation,
  type SemanticEvaluationDiagnostic,
  type SemanticEvaluationInput,
  type SemanticEvaluationResult,
  type SemanticModelProvider,
  type SemanticModelRequest,
  type SemanticNoEvaluation,
  type SemanticTechnicalErrorCode
} from "./types";

export const SEMANTIC_EVALUATOR_INSTRUCTIONS = [
  "Analyze only the supplied rule criterion.",
  "Use only the supplied Evidence excerpts and minimal context.",
  "Do not infer facts that are not present in the supplied Evidence.",
  "Do not apply legal knowledge outside the supplied criterion.",
  "Choose MANUAL_CHECK when the Evidence is ambiguous or insufficient.",
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
    status: z.enum(SEMANTIC_EVALUATION_STATUSES),
    confidence: z.number().min(0).max(1),
    reason_code: z.string().min(1).max(80),
    reason: z.string().min(1).max(1_000),
    evidence_refs: z.array(z.string().min(1))
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
      const result = noEvaluation("Semantic provider response was not valid JSON.", "MALFORMED_PROVIDER_RESPONSE");
      emitDiagnostic(options, input.ruleId, startedAt, "invalid_response", result);
      return result;
    }

    const validation = providerResponseSchema.safeParse(parsed.value);
    if (!validation.success) {
      const result = noEvaluation("Semantic provider response failed schema validation.", "SCHEMA_VALIDATION_FAILED");
      emitDiagnostic(options, input.ruleId, startedAt, "invalid_response", result);
      return result;
    }

    const allowedRefs = new Set(input.evidence.map((item) => item.ref));
    if (validation.data.evidence_refs.some((ref) => !allowedRefs.has(ref))) {
      const result = noEvaluation("Semantic provider referenced evidence outside the supplied package.", "SCHEMA_VALIDATION_FAILED");
      emitDiagnostic(options, input.ruleId, startedAt, "invalid_response", result);
      return result;
    }

    const result: SemanticEvaluation = {
      status: validation.data.status,
      confidence: validation.data.confidence,
      reasonCode: validation.data.reason_code,
      reason: validation.data.reason,
      evidenceRefs: validation.data.evidence_refs
    };
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

function noEvaluation(reason: string, technicalErrorCode: SemanticTechnicalErrorCode): SemanticNoEvaluation {
  return { status: "NO_EVALUATION", reason, technicalErrorCode };
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
    technicalErrorCode: result.status === "NO_EVALUATION" ? result.technicalErrorCode : undefined
  });
}
