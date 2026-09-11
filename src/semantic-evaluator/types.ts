import type { EvidenceType } from "@/evidence/types";
import type { Fact } from "@/facts/types";

export const SEMANTIC_EVALUATION_STATUSES = ["PASS", "FAIL", "MANUAL_CHECK"] as const;
export type SemanticEvaluationStatus = (typeof SEMANTIC_EVALUATION_STATUSES)[number];

export const SEMANTIC_OUTPUT_LIMITS = {
  confidence: { minimum: 0, maximum: 1 },
  reasonCode: { minLength: 1, maxLength: 80 },
  reason: { minLength: 1, maxLength: 1_000 },
  evidenceRef: { minLength: 1 }
} as const;

export const SEMANTIC_EVIDENCE_COMPLETENESS = ["COMPLETE", "PARTIAL", "TRUNCATED", "UNKNOWN"] as const;
export type SemanticEvidenceCompleteness = (typeof SEMANTIC_EVIDENCE_COMPLETENESS)[number];

export type SemanticTechnicalErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "MALFORMED_PROVIDER_RESPONSE"
  | "SCHEMA_VALIDATION_FAILED"
  | "EVIDENCE_REF_MISMATCH"
  | "INPUT_TOO_LARGE";

export type SemanticSchemaFailureKind =
  | "MISSING_FIELD"
  | "EXTRA_FIELD"
  | "TYPE_MISMATCH"
  | "ENUM_MISMATCH"
  | "JSON_PARSE_FAILED"
  | "CONSTRAINT_VIOLATION"
  | "OTHER_SCHEMA_FAILURE";

export interface SemanticSchemaFailureDiagnostic {
  kind: SemanticSchemaFailureKind;
  jsonParseSuccess: boolean;
  presentFields: string[];
  missingRequiredFields: string[];
  unexpectedFields: string[];
  field?: string;
  expectedType?: string;
  actualType?: string;
  enumExpected?: string[];
  enumActual?: string;
  constraint?: string;
  limit?: number;
}

export interface SemanticEvidenceExcerpt {
  ref: string;
  evidenceId: string;
  evidenceType: EvidenceType;
  pageUrl?: string;
  excerpt: string;
  completeness: SemanticEvidenceCompleteness;
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
  schemaFailure?: SemanticSchemaFailureDiagnostic;
}

export type SemanticEvaluationResult = SemanticEvaluation | SemanticNoEvaluation;

export interface SemanticEvaluationDiagnostic {
  ruleId: string;
  providerStatus: "ok" | "timeout" | "error" | "invalid_response";
  durationMs: number;
  resultStatus?: SemanticEvaluationResult["status"];
  technicalErrorCode?: SemanticTechnicalErrorCode;
  schemaFailure?: SemanticSchemaFailureDiagnostic;
}
