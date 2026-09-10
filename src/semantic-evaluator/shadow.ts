import type { Scan } from "@/db/schema";
import type { Evidence } from "@/evidence/types";
import type { Fact } from "@/facts/types";
import { loadPilotSemanticRuntimeRules } from "@/legal-rules/runtime";
import type { Rule } from "@/rule-engine/types";
import { evaluateSemanticRule, type EvaluateSemanticRuleOptions } from "./evaluator";
import { FakeSemanticModelProvider } from "./fake-provider";
import type {
  SemanticEvaluation,
  SemanticEvaluationInput,
  SemanticEvaluationResult,
  SemanticEvidenceExcerpt,
  SemanticModelProvider
} from "./types";

export interface SemanticShadowEvaluation {
  ruleId: string;
  ruleVersion: string;
  status: SemanticEvaluationResult["status"];
  criterion: string;
  evidenceRefs: string[];
  result: SemanticEvaluationResult;
}

export interface EvaluateSemanticShadowRulesInput {
  scan: Scan;
  facts: Fact[];
  evidence: Evidence[];
  rules?: Rule[];
  provider?: SemanticModelProvider;
  timeoutMs?: number;
  onDiagnostic?: EvaluateSemanticRuleOptions["onDiagnostic"];
}

const defaultShadowProvider = new FakeSemanticModelProvider({
  status: "MANUAL_CHECK",
  confidence: 0.5,
  reason_code: "SHADOW_FAKE_PROVIDER",
  reason: "Fake shadow provider does not make semantic conclusions.",
  evidence_refs: []
});

export async function evaluateSemanticRulesShadow(
  input: EvaluateSemanticShadowRulesInput
): Promise<SemanticShadowEvaluation[]> {
  const rules = input.rules ?? loadPilotSemanticRuntimeRules();
  const provider = input.provider ?? defaultShadowProvider;
  const results: SemanticShadowEvaluation[] = [];

  for (const rule of rules) {
    if (rule.evaluatorType !== "LLM_SEMANTIC") {
      continue;
    }

    if (!rule.appliesTo.includes(input.scan.siteType)) {
      results.push(noShadowEvaluation(rule, "Rule does not apply to this site_type."));
      continue;
    }

    if (rule.evaluation.kind !== "SEMANTIC_CRITERION") {
      results.push(noShadowEvaluation(rule, `Unsupported semantic evaluation kind=${rule.evaluation.kind}`));
      continue;
    }
    const evaluation = rule.evaluation;

    const evidencePackage = buildEvidencePackage(input.facts, input.evidence, evaluation.evidence_fact_types);
    if (evidencePackage.length === 0) {
      results.push(noShadowEvaluation(rule, "Required semantic evidence is missing."));
      continue;
    }

    const semanticInput: SemanticEvaluationInput = {
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      criterion: evaluation.criterion,
      evidence: evidencePackage,
      facts: input.facts
        .filter((fact) => evaluation.evidence_fact_types.includes(fact.factType))
        .map((fact) => ({ id: fact.id, factType: fact.factType, pageUrl: fact.pageUrl, value: fact.value })),
      context: {
        siteType: input.scan.siteType,
        ...(evaluation.context ?? {})
      }
    };

    const rawResult = await evaluateSemanticRule(semanticInput, {
      provider,
      timeoutMs: input.timeoutMs,
      onDiagnostic: input.onDiagnostic
    });
    const result = guardTruncatedPolicyFail(rawResult, evidencePackage);

    results.push({
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      status: result.status,
      criterion: evaluation.criterion,
      evidenceRefs: result.status === "NO_EVALUATION" ? [] : result.evidenceRefs,
      result
    });
  }

  return results;
}

function buildEvidencePackage(facts: Fact[], evidence: Evidence[], factTypes: string[]): SemanticEvidenceExcerpt[] {
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const refs = new Set<string>();
  const packageItems: SemanticEvidenceExcerpt[] = [];

  for (const item of evidence) {
    if (!item.factId) {
      continue;
    }

    const fact = factsById.get(item.factId);
    if (!fact || !factTypes.includes(fact.factType)) {
      continue;
    }

    const excerpt = evidenceText(item, fact);
    if (!excerpt) {
      continue;
    }

    const refBase = `${fact.factType}:${item.id}`;
    const ref = refs.has(refBase) ? `${refBase}:${packageItems.length + 1}` : refBase;
    refs.add(ref);

    packageItems.push({
      ref,
      evidenceId: item.id,
      evidenceType: item.evidenceType,
      pageUrl: item.pageUrl || fact.pageUrl,
      excerpt,
      metadata: evidenceMetadata(item, fact)
    });
  }

  return packageItems;
}

function evidenceText(evidence: Evidence, fact: Fact): string | undefined {
  const payload = evidence.payload ?? {};
  const value = fact.value;
  const candidates = [payload.text, payload.context, payload.excerpt, value.text, value.context];
  const text = candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
  return text?.trim();
}

function evidenceMetadata(evidence: Evidence, fact: Fact): Record<string, unknown> {
  const payload = evidence.payload ?? {};
  return {
    factType: fact.factType,
    sourceUrl: typeof payload.sourceUrl === "string" ? payload.sourceUrl : evidence.pageUrl || fact.pageUrl,
    truncated: payload.truncated === true || fact.value.truncated === true,
    originalTextLength: payload.originalTextLength ?? fact.value.originalTextLength,
    maxChars: payload.maxChars ?? fact.value.maxChars
  };
}

function guardTruncatedPolicyFail(
  result: SemanticEvaluationResult,
  evidencePackage: SemanticEvidenceExcerpt[]
): SemanticEvaluationResult {
  if (result.status !== "FAIL" || !evidencePackage.some(isTruncatedPolicyEvidence)) {
    return result;
  }

  const guarded: SemanticEvaluation = {
    status: "MANUAL_CHECK",
    confidence: Math.min(result.confidence, 0.5),
    reasonCode: "TRUNCATED_POLICY_REQUIRES_MANUAL_CHECK",
    reason: "Policy evidence was truncated, so shadow mode cannot produce an absence-based FAIL.",
    evidenceRefs: result.evidenceRefs
  };
  return guarded;
}

function isTruncatedPolicyEvidence(item: SemanticEvidenceExcerpt): boolean {
  return item.metadata?.factType === "privacy_policy_text" && item.metadata.truncated === true;
}

function noShadowEvaluation(rule: Rule, reason: string): SemanticShadowEvaluation {
  const result: SemanticEvaluationResult = {
    status: "NO_EVALUATION",
    reason,
    technicalErrorCode: "SCHEMA_VALIDATION_FAILED"
  };
  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.version,
    status: result.status,
    criterion: rule.evaluation.kind === "SEMANTIC_CRITERION" ? rule.evaluation.criterion : "",
    evidenceRefs: [],
    result
  };
}
