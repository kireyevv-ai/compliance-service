import type { Scan } from "@/db/schema";
import type { Evidence } from "@/evidence/types";
import type { Fact } from "@/facts/types";
import { loadPilotSemanticRuntimeRules } from "@/legal-rules/runtime";
import type { Rule } from "@/rule-engine/types";
import { classifySemanticEvidenceCompleteness } from "./completeness";
import { evaluateSemanticRule, type EvaluateSemanticRuleOptions } from "./evaluator";
import { FakeSemanticModelProvider } from "./fake-provider";
import type {
  SemanticEvaluation,
  SemanticEvaluationInput,
  SemanticEvaluationResult,
  SemanticEvidenceCompleteness,
  SemanticEvidenceExcerpt,
  SemanticModelProvider,
  SemanticTechnicalErrorCode
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
  observation: "AMBIGUOUS",
  confidence: 0.5,
  reason_code: "SHADOW_FAKE_PROVIDER",
  reason: "Fake shadow provider does not make semantic conclusions.",
  evidence_refs: []
});

export const SEMANTIC_SHADOW_TOTAL_EVIDENCE_TEXT_LIMIT = 60_000;

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

    if (typeof evaluation.context?.requires_fact_true === "string" && !hasTruthyFact(input.facts, evaluation.context.requires_fact_true)) {
      results.push(noShadowEvaluation(rule, `Rule requires fact ${evaluation.context.requires_fact_true}=true.`));
      continue;
    }

    const evidencePackage = buildEvidencePackage(input.facts, input.evidence, evaluation.evidence_fact_types);
    if (evidencePackage.length === 0) {
      results.push(noShadowEvaluation(rule, "Required semantic evidence is missing."));
      continue;
    }

    if (evaluation.context?.requires_policy_no_third_party_claim === true && !hasNoThirdPartyTransferClaim(evidencePackage)) {
      results.push(noShadowEvaluation(rule, "Rule is not applicable because policy has no explicit no-transfer claim."));
      continue;
    }

    if (totalEvidenceTextLength(evidencePackage) > SEMANTIC_SHADOW_TOTAL_EVIDENCE_TEXT_LIMIT) {
      results.push(
        noShadowEvaluation(
          rule,
          `Semantic evidence package exceeds total text limit of ${SEMANTIC_SHADOW_TOTAL_EVIDENCE_TEXT_LIMIT} chars.`,
          "INPUT_TOO_LARGE"
        )
      );
      continue;
    }

    const semanticInput: SemanticEvaluationInput = {
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      criterion: evaluation.criterion,
      evidence: evidencePackage,
      facts: input.facts
        .filter((fact) => evaluation.evidence_fact_types.includes(fact.factType))
        .map((fact) => ({
          id: fact.id,
          factType: fact.factType,
          pageUrl: sanitizeUrlForModel(fact.pageUrl),
          value: modelFacingFactValue(fact)
        })),
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
      pageUrl: sanitizeUrlForModel(item.pageUrl || fact.pageUrl),
      excerpt,
      completeness: evidenceCompleteness(item, fact),
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
  return text?.trim() ?? structuredEvidenceText(fact, evidence);
}

function evidenceMetadata(evidence: Evidence, fact: Fact): Record<string, unknown> {
  const payload = evidence.payload ?? {};
  return {
    factType: fact.factType,
    sourceUrl: sanitizeUrlForModel(typeof payload.sourceUrl === "string" ? payload.sourceUrl : evidence.pageUrl || fact.pageUrl),
    documentType: payload.documentType ?? fact.value.documentType,
    fetchStatus: payload.fetchStatus ?? fact.value.fetchStatus,
    fetchContentType: payload.fetchContentType ?? fact.value.fetchContentType,
    contentLimited: payload.contentLimited ?? fact.value.contentLimited,
    limitationReason: payload.limitationReason ?? fact.value.limitationReason,
    interstitialDetected: payload.interstitialDetected ?? fact.value.interstitialDetected,
    extractionSucceeded: payload.extractionSucceeded ?? fact.value.extractionSucceeded,
    extractionRoot: payload.extractionRoot ?? fact.value.extractionRoot,
    extractionRootFallback: payload.extractionRootFallback ?? fact.value.extractionRootFallback,
    truncated: payload.truncated === true || fact.value.truncated === true,
    originalTextLength: payload.originalTextLength ?? fact.value.originalTextLength,
    maxChars: payload.maxChars ?? fact.value.maxChars,
    semanticCompleteness: payload.semanticCompleteness ?? fact.value.semanticCompleteness,
    serviceName: payload.service_name ?? fact.value.service_name,
    serviceCategory: payload.category ?? fact.value.category,
    signalType: payload.signal_type ?? fact.value.signal_type,
    providerScope: payload.provider_scope ?? fact.value.provider_scope
  };
}

function structuredEvidenceText(fact: Fact, evidence: Evidence): string | undefined {
  if (fact.factType === "form_fields") {
    return formFieldsEvidenceText(fact);
  }

  if (fact.factType === "external_service_matches") {
    return externalServiceEvidenceText(fact);
  }

  return undefined;
}

function formFieldsEvidenceText(fact: Fact): string | undefined {
  const fields = Array.isArray(fact.value.fields) ? fact.value.fields : [];
  const relevantFields = fields
    .map((field) => (field && typeof field === "object" ? (field as Record<string, unknown>) : undefined))
    .filter((field): field is Record<string, unknown> => field !== undefined)
    .filter((field) => !isTechnicalFormField(field));
  if (relevantFields.length === 0) {
    return undefined;
  }

  const fieldText = relevantFields
    .map((field) => {
      const categories = Array.isArray(field.personalDataCategories)
        ? field.personalDataCategories.filter((item): item is string => typeof item === "string").join(", ")
        : "";
      const descriptors = [field.label, field.placeholder, field.name, field.id, field.autocomplete, field.type]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(" / ");
      return `${categories || "unclassified"}${descriptors ? ` (${descriptors})` : ""}`;
    })
    .join("; ");

  return `Form fields visible on ${sanitizeUrlForModel(fact.pageUrl) ?? "the checked page"}: ${fieldText}. Technical hidden, token, captcha, and honeypot fields are not included.`;
}

function isTechnicalFormField(field: Record<string, unknown>): boolean {
  const descriptor = [field.type, field.name, field.id, field.label, field.placeholder]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
  return (
    descriptor.includes("hidden") ||
    /(csrf|token|captcha|honeypot|_method|sess|session)/i.test(descriptor)
  );
}

function externalServiceEvidenceText(fact: Fact): string | undefined {
  const serviceName = asString(fact.value.service_name);
  const category = asString(fact.value.category);
  const signalType = asString(fact.value.signal_type);
  const matchedHost = asString(fact.value.matched_host);
  const providerScope = asString(fact.value.provider_scope);
  if (!serviceName && !category && !matchedHost) {
    return undefined;
  }

  return [
    `Relevant external service detected on ${sanitizeUrlForModel(fact.pageUrl) ?? "the checked page"}:`,
    serviceName ? `service ${serviceName}` : undefined,
    category ? `category ${category}` : undefined,
    signalType ? `signal ${signalType}` : undefined,
    matchedHost ? `host ${matchedHost}` : undefined,
    providerScope ? `provider scope ${providerScope}` : undefined
  ]
    .filter(Boolean)
    .join(" ");
}

function hasNoThirdPartyTransferClaim(evidence: SemanticEvidenceExcerpt[]): boolean {
  return evidence.some((item) => {
    if (item.metadata?.factType !== "privacy_policy_text") {
      return false;
    }
    const text = item.excerpt.toLowerCase();
    return [
      /не\s+переда[её]м\s+(?:персональные\s+данные\s+)?(?:третьим\s+лицам|третьим\s+сторонам)/,
      /персональные\s+данные\s+(?:третьим\s+лицам|третьим\s+сторонам)\s+не\s+(?:передаются|предоставляются|раскрываются)/,
      /не\s+(?:предоставляем|раскрываем)\s+персональные\s+данные\s+(?:третьим\s+лицам|третьим\s+сторонам)/
    ].some((pattern) => pattern.test(text));
  });
}

function hasTruthyFact(facts: Fact[], factType: string): boolean {
  return facts.some((fact) => fact.factType === factType && fact.value.found === true);
}

function evidenceCompleteness(evidence: Evidence, fact: Fact): SemanticEvidenceCompleteness {
  const payload = evidence.payload ?? {};
  return classifySemanticEvidenceCompleteness({ ...fact.value, ...payload });
}

function totalEvidenceTextLength(evidencePackage: SemanticEvidenceExcerpt[]): number {
  return evidencePackage.reduce((total, item) => total + item.excerpt.length, 0);
}

function modelFacingFactValue(fact: Fact): Record<string, unknown> {
  return {
    formIndex: fact.value.formIndex,
    controlIndex: fact.value.controlIndex,
    sourceUrl: sanitizeUrlForModel(asString(fact.value.sourceUrl)),
    documentType: fact.value.documentType,
    fetchStatus: fact.value.fetchStatus,
    fetchContentType: fact.value.fetchContentType,
    contentLimited: fact.value.contentLimited,
    limitationReason: fact.value.limitationReason,
    interstitialDetected: fact.value.interstitialDetected,
    extractionSucceeded: fact.value.extractionSucceeded,
    extractionRoot: fact.value.extractionRoot,
    extractionRootFallback: fact.value.extractionRootFallback,
    truncated: fact.value.truncated,
    originalTextLength: fact.value.originalTextLength,
    textLength: fact.value.textLength,
    maxChars: fact.value.maxChars
  };
}

function sanitizeUrlForModel(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
    observation: result.observation,
    confidence: Math.min(result.confidence, 0.5),
    reasonCode: "TRUNCATED_POLICY_REQUIRES_MANUAL_CHECK",
    reason: "Policy evidence was truncated, so shadow mode cannot produce an absence-based FAIL.",
    evidenceRefs: result.evidenceRefs
  };
  return guarded;
}

function isTruncatedPolicyEvidence(item: SemanticEvidenceExcerpt): boolean {
  return item.metadata?.factType === "privacy_policy_text" && item.completeness === "TRUNCATED";
}

function noShadowEvaluation(
  rule: Rule,
  reason: string,
  technicalErrorCode: SemanticTechnicalErrorCode = "SCHEMA_VALIDATION_FAILED"
): SemanticShadowEvaluation {
  const result: SemanticEvaluationResult = {
    status: "NO_EVALUATION",
    reason,
    technicalErrorCode
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
