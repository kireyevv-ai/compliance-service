import wave1Rules from "./rules/wave1-runtime-rules.json";
import { validateRuntimeRules } from "./schema";
import type { Rule } from "@/rule-engine/types";

export function loadRuntimeRules(): Rule[] {
  return validateRuntimeRules(wave1Rules).map((rule) => ({
    ruleId: rule.rule_id,
    version: rule.version,
    title: rule.title,
    passSummary: rule.pass_summary,
    module: rule.module,
    appliesTo: rule.applies_to,
    requiredFacts: rule.required_facts,
    legalBasis: rule.legal_basis,
    severity: rule.severity,
    statusIfTriggered: rule.status_if_triggered ?? "FAIL",
    legalStrength: rule.legal_strength ?? "MANDATORY",
    evidenceRequirements: rule.evidence_requirements ?? [],
    evaluation: rule.evaluation,
    remediation: rule.remediation,
    confidencePolicy: rule.confidence_policy,
    limitations: rule.limitations,
    effectiveFrom: rule.effective_from,
    effectiveTo: rule.effective_to,
    lastVerifiedAt: rule.last_verified_at
  }));
}
