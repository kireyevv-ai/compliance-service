import type { EvidenceType } from "@/evidence/types";
import type { Fact } from "@/facts/types";

export const SEMANTIC_EVALUATION_STATUSES = ["PASS", "FAIL", "MANUAL_CHECK"] as const;
export type SemanticEvaluationStatus = (typeof SEMANTIC_EVALUATION_STATUSES)[number];

export type SemanticTechnicalErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "MALFORMED_PROVIDER_RESPONSE"
  | "SCHEMA_VALIDATION_FAILED"
  | "INPUT_TOO_LARGE";

export interface SemanticEvidenceExcerpt {
  ref: string;
  evidenceId: string;
  evidenceType: EvidenceType;
  pageUrl?: string;
  excerpt: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticEvaluationInput {
  ruleId: string;
  ruleVersion: string;
  criterion: string;
  evidence: SemanticEvidenceExcerpt[];
  facts?: Pick<Fact, "id" | "factType" | "pageUrl" | "value">[];
  context?: Record<string, unknown>;
}

export interface SemanticModelRequest {
  instructions: string;
  ruleId: string;
  ruleVersion: string;
  criterion: string;
  evidence: SemanticEvidenceExcerpt[];
  facts?: Pick<Fact, "id" | "factType" | "pageUrl" | "value">[];
  context?: Record<string, unknown>;
}

export interface SemanticModelProvider {
  evaluate(request: SemanticModelRequest): Promise<unknown>;
}

export interface SemanticEvaluation {
  status: SemanticEvaluationStatus;
  confidence: number;
  reasonCode: string;
  reason: string;
  evidenceRefs: string[];
}

export interface SemanticNoEvaluation {
  status: "NO_EVALUATION";
  reason: string;
  technicalErrorCode: SemanticTechnicalErrorCode;
}

export type SemanticEvaluationResult = SemanticEvaluation | SemanticNoEvaluation;

export interface SemanticEvaluationDiagnostic {
  ruleId: string;
  providerStatus: "ok" | "timeout" | "error" | "invalid_response";
  durationMs: number;
  resultStatus?: SemanticEvaluationResult["status"];
  technicalErrorCode?: SemanticTechnicalErrorCode;
}
