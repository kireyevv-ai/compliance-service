import type { FindingStatus, SiteType } from "@/db/schema";
import type { Fact } from "@/facts/types";

export const OWNER_ANSWER_PROVENANCE = "OWNER" as const;

export type OwnerQuestionAnswerType = "YES_NO" | "SINGLE_SELECT" | "MULTI_SELECT";

export interface OwnerQuestionOption {
  optionId: string;
  label: string;
}

export interface OwnerQuestionDefinition {
  questionId: string;
  text: string;
  explanation: string;
  answerType: OwnerQuestionAnswerType;
  options: OwnerQuestionOption[];
  exclusiveOptionIds?: string[];
  required: boolean;
  allowUnknown: boolean;
}

export type OwnerAnswerValue =
  | { type: "YES_NO"; value: boolean }
  | { type: "SINGLE_SELECT"; optionId: string }
  | { type: "MULTI_SELECT"; optionIds: string[] }
  | { unknown: true };

export interface OwnerAnswer {
  id: string;
  scanId: string;
  questionId: string;
  answer: OwnerAnswerValue;
  provenance: typeof OWNER_ANSWER_PROVENANCE;
  answeredAt: Date;
  updatedAt: Date;
}

export type OwnerApplicabilityStatus = "REQUIRED" | "NOT_NEEDED" | "UNRESOLVED";

export type OwnerEvaluationStatus = FindingStatus | "NOT_APPLICABLE" | "UNRESOLVED";

export type OwnerReasonCode =
  | "ANSWER_REQUIRED"
  | "APPLICABILITY_UNRESOLVED"
  | "OWNER_ANSWER_CONFLICTS_WITH_SITE_EVIDENCE"
  | "OWNER_UNKNOWN"
  | "RULE_POLICY_REQUIRES_MANUAL_CHECK";

export interface SiteFactRef {
  factId: string;
  factType: string;
  pageUrl?: string;
}

export interface OwnerAnswerRef {
  questionId: string;
  answerId: string;
}

export interface OwnerContextInput {
  siteType: SiteType;
  facts: Fact[];
  answers: OwnerAnswer[];
}

export interface OwnerRuleMapping {
  ruleId: string;
  questionIds: string[];
  legallyAmbiguous?: boolean;
  evaluate: (context: OwnerContextInput) => OwnerRuleEvaluation;
}

export interface OwnerRuleEvaluation {
  ruleId: string;
  applicability: OwnerApplicabilityStatus;
  status: OwnerEvaluationStatus;
  questionIds: string[];
  reasonCode?: OwnerReasonCode;
  ownerAnswer?: OwnerAnswerValue;
  ownerAnswerRefs: OwnerAnswerRef[];
  siteEvidenceRefs: SiteFactRef[];
  siteFactRefs: SiteFactRef[];
  conflictDetected: boolean;
  explanation: string;
}
