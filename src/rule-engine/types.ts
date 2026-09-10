import type { SiteType, FindingStatus, Severity } from "@/db/schema";

export type EvaluatorType = "DETERMINISTIC" | "LLM_SEMANTIC" | "OWNER_MANUAL";

export interface RuleEvaluationDefinition {
  kind: "FACT_PATTERN";
  conditions: Record<string, unknown>;
}

export interface Rule {
  ruleId: string;
  version: string;
  title: string;
  passSummary: string;
  module: string;
  evaluatorType: EvaluatorType;
  legalStrength: string;
  statusIfTriggered: FindingStatus;
  appliesTo: SiteType[];
  requiredFacts: string[];
  evidenceRequirements: string[];
  legalBasis: string[];
  severity: Severity;
  evaluation: RuleEvaluationDefinition;
  remediation: string;
  confidencePolicy: Record<string, unknown>;
  limitations: string[];
  effectiveFrom: string;
  effectiveTo?: string;
  lastVerifiedAt: string;
}

export interface RuleEvaluation {
  ruleId: string;
  ruleVersion: string;
  status: FindingStatus;
  severity: Severity;
  confidence: number;
  summary: string;
  explanation: string;
  remediation: string;
  evidenceIds: string[];
  missingContext: string[];
}

export interface NoEvaluation {
  ruleId: string;
  ruleVersion: string;
  status: "NO_EVALUATION";
  reason: string;
}

export type RuleEvaluationResult = RuleEvaluation | NoEvaluation;
