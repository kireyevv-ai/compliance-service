import syntheticRule from "@/legal-rules/rules/synthetic-example-rule.json";
import syntheticServices from "@/external-services/catalog/synthetic-services.json";
import { validateExternalServicesCatalog } from "@/external-services/schema";
import { validateRuleDefinition } from "@/legal-rules/schema";
import { describe, expect, it } from "vitest";

describe("versioned JSON structure validation", () => {
  it("validates the synthetic rule fixture", () => {
    const rule = validateRuleDefinition(syntheticRule);

    expect(rule.test_only).toBe(true);
    expect(rule.rule_id).toBe("TEST_SYNTHETIC_FORM_FACT_PRESENT");
    expect(rule.evaluator_type).toBe("DETERMINISTIC");
    expect(rule.pass_summary).toBe("Synthetic test fact is present.");
  });

  it("accepts all supported evaluator types", () => {
    for (const evaluatorType of ["DETERMINISTIC", "LLM_SEMANTIC", "OWNER_MANUAL"] as const) {
      const rule = validateRuleDefinition({ ...syntheticRule, evaluator_type: evaluatorType });

      expect(rule.evaluator_type).toBe(evaluatorType);
    }
  });

  it("rejects unsupported evaluator types", () => {
    expect(() =>
      validateRuleDefinition({ ...syntheticRule, evaluator_type: "UNSUPPORTED_EVALUATOR" })
    ).toThrow();
  });

  it("validates the synthetic external services catalog", () => {
    const catalog = validateExternalServicesCatalog(syntheticServices);

    expect(catalog).toHaveLength(2);
    expect(catalog.every((service) => service.test_only)).toBe(true);
  });
});
