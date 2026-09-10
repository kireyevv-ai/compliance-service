import { z } from "zod";
import { FINDING_STATUSES, SEVERITIES, SITE_TYPES } from "@/db/schema";

export const ruleEvaluationDefinitionSchema = z.object({
  kind: z.literal("FACT_PATTERN"),
  conditions: z.record(z.string(), z.unknown())
});

export const ruleSchema = z.object({
  rule_id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  pass_summary: z.string().min(1),
  module: z.string().min(1),
  legal_strength: z.enum(["MANDATORY", "REGULATOR_RECOMMENDATION", "RISK_SIGNAL"]).optional(),
  status_if_triggered: z.enum(FINDING_STATUSES).optional(),
  applies_to: z.array(z.enum(SITE_TYPES)).min(1),
  required_facts: z.array(z.string().min(1)),
  evidence_requirements: z.array(z.string().min(1)).optional(),
  legal_basis: z.array(z.string()),
  severity: z.enum(SEVERITIES),
  evaluation: ruleEvaluationDefinitionSchema,
  remediation: z.string().min(1),
  confidence_policy: z.record(z.string(), z.unknown()),
  limitations: z.array(z.string()),
  effective_from: z.string().min(1),
  effective_to: z.string().optional(),
  last_verified_at: z.string().min(1),
  test_only: z.boolean().optional(),
  expected_status_for_test: z.enum(FINDING_STATUSES).optional()
});

export const runtimeRulesSchema = z.array(ruleSchema);

export type RuleDefinitionFile = z.infer<typeof ruleSchema>;

export function validateRuleDefinition(input: unknown): RuleDefinitionFile {
  return ruleSchema.parse(input);
}

export function validateRuntimeRules(input: unknown): RuleDefinitionFile[] {
  return runtimeRulesSchema.parse(input);
}
