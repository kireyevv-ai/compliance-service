import type { RuleEvaluation } from "@/rule-engine/types";

export function assertEvidencePolicy(evaluation: RuleEvaluation): void {
  if (evaluation.status === "FAIL" && evaluation.evidenceIds.length === 0) {
    throw new Error("FAIL findings require evidence");
  }

  if (
    evaluation.status === "WARNING" &&
    evaluation.evidenceIds.length === 0 &&
    evaluation.missingContext.length === 0
  ) {
    throw new Error("WARNING findings require evidence or explicit missing context");
  }
}
