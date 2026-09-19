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
      const bridged = recommendationRulesDocumentAccessBridge(rule, input);
      if (bridged) {
        results.push(bridged);
        continue;
      }
      results.push(noShadowEvaluation(rule, "Required semantic evidence is missing."));
      continue;
    }

    const applicabilityReason = semanticRuleApplicabilityBlockReason(rule, input.facts, evidencePackage);
    if (applicabilityReason) {
      results.push(noShadowEvaluation(rule, applicabilityReason));
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
    const result = guardCookiePolicyCompletenessFail(rule.ruleId, guardTruncatedPolicyFail(rawResult, evidencePackage), evidencePackage);
    const guardedResult = guardEc016ContradictionFail(rule.ruleId, result, evidencePackage);

    results.push({
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      status: guardedResult.status,
      criterion: evaluation.criterion,
      evidenceRefs: guardedResult.status === "NO_EVALUATION" ? [] : guardedResult.evidenceRefs,
      result: guardedResult
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

  if (fact.factType === "cookie_metadata") {
    return cookieMetadataEvidenceText(fact);
  }

  if (fact.factType === "local_storage_keys" || fact.factType === "session_storage_keys") {
    return storageKeysEvidenceText(fact);
  }

  if (fact.factType === "network_request_hosts" || fact.factType === "script_sources_rendered" || fact.factType === "iframe_sources_rendered") {
    return hostListEvidenceText(fact);
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

function cookieMetadataEvidenceText(fact: Fact): string | undefined {
  const names = arrayOfStrings(fact.value.cookieNames ?? fact.value.names ?? fact.value.cookies);
  const domains = arrayOfStrings(fact.value.domains);
  if (names.length === 0 && domains.length === 0) {
    return undefined;
  }
  return [
    `Browser state contains cookies on ${sanitizeUrlForModel(fact.pageUrl) ?? "the checked page"}.`,
    names.length > 0 ? `Cookie names: ${names.slice(0, 20).join(", ")}.` : undefined,
    domains.length > 0 ? `Cookie domains: ${domains.slice(0, 20).join(", ")}.` : undefined
  ]
    .filter(Boolean)
    .join(" ");
}

function storageKeysEvidenceText(fact: Fact): string | undefined {
  const keys = arrayOfStrings(fact.value.keys);
  if (keys.length === 0) {
    return undefined;
  }
  const storage = fact.factType === "local_storage_keys" ? "localStorage" : "sessionStorage";
  return `${storage} keys observed on ${sanitizeUrlForModel(fact.pageUrl) ?? "the checked page"}: ${keys.slice(0, 30).join(", ")}.`;
}

function hostListEvidenceText(fact: Fact): string | undefined {
  const hosts = arrayOfStrings(fact.value.hosts ?? fact.value.sources ?? fact.value.urls);
  if (hosts.length === 0) {
    return undefined;
  }
  return `Observed ${fact.factType} on ${sanitizeUrlForModel(fact.pageUrl) ?? "the checked page"}: ${hosts.slice(0, 30).join(", ")}.`;
}

function semanticRuleApplicabilityBlockReason(
  rule: Rule,
  facts: Fact[],
  evidencePackage: SemanticEvidenceExcerpt[]
): string | undefined {
  if (rule.ruleId === "CK-001") {
    if (!evidencePackage.some((item) => item.metadata?.factType === "privacy_policy_text")) {
      return "Cookie disclosure check requires privacy policy text.";
    }
    if (!hasRelevantCookieOrTrackerContext(facts, evidencePackage)) {
      return "Cookie disclosure check requires relevant cookie, storage, tracker, or analytics context.";
    }
  }

  if (rule.ruleId === "CK-004" && !hasBundledCookieConsentContext(evidencePackage)) {
    return "Cookie consent separation check requires cookie, analytics, or marketing consent together with mandatory terms context.";
  }

  if (rule.ruleId === "EC-014" && !hasProductPageContext(evidencePackage)) {
    return "Product information check requires product or product-card page evidence.";
  }

  if (rule.ruleId === "EC-015" && !hasPreContractTermsContext(evidencePackage)) {
    return "Purchase/payment/delivery terms check requires pre-contract consumer material.";
  }

  if (rule.ruleId === "EC-016" && !hasReturnRefundContext(evidencePackage)) {
    return "Return/refund contradiction check requires return or refund material.";
  }

  return undefined;
}

function hasRelevantCookieOrTrackerContext(facts: Fact[], evidencePackage: SemanticEvidenceExcerpt[]): boolean {
  const factText = facts
    .filter((fact) =>
      ["cookie_metadata", "local_storage_keys", "session_storage_keys", "network_request_hosts", "script_sources_rendered", "iframe_sources_rendered", "external_service_matches"].includes(
        fact.factType
      )
    )
    .map((fact) => JSON.stringify(fact.value))
    .join(" ");
  const evidenceText = evidencePackage.map((item) => item.excerpt).join(" ");
  return isRelevantCookieOrTrackerText(`${factText} ${evidenceText}`);
}

function hasBundledCookieConsentContext(evidencePackage: SemanticEvidenceExcerpt[]): boolean {
  const text = evidencePackage.map((item) => item.excerpt).join(" ").toLowerCase();
  const hasTrackingConsent = /(cookie|cookies|куки|аналитик|analytics|метрик|маркетинг|маркетингов|реклам|рассыл|трекер|tracking|статистик)/i.test(
    text
  );
  const hasMandatoryContext =
    /(персональн[а-я\s-]*данн|обработк[а-я\s-]*данн|оферт|договор|пользовательск|соглашени|услови|terms|agreement|privacy|policy)/i.test(
      text
    );
  return hasTrackingConsent && hasMandatoryContext;
}

function isRelevantCookieOrTrackerText(text: string): boolean {
  return /(_ga|_gid|_ym|ym_|tmr_lvid|roistat|fbp|fbc|uid|userid|user_id|clientid|client_id|visitor|tracking|analytics|marketing|advert|ads?|doubleclick|googletagmanager|google-analytics|metrika|mc\.yandex|retarget|remarket|pixel|email_marketing|crm|session|checkout|phone|email)/i.test(
    text
  );
}

function hasProductPageContext(evidencePackage: SemanticEvidenceExcerpt[]): boolean {
  return evidencePackage.some((item) => {
    const text = `${item.pageUrl ?? ""} ${item.excerpt}`.toLowerCase();
    return /(product|tovar|catalog|item|sku|товар|карточк|артикул|характеристик|описани|купить|цена|₽|руб)/i.test(text);
  });
}

function hasPreContractTermsContext(evidencePackage: SemanticEvidenceExcerpt[]): boolean {
  return evidencePackage.some((item) => {
    const text = `${item.pageUrl ?? ""} ${item.excerpt}`.toLowerCase();
    return /(offer|oferta|terms|checkout|cart|basket|order|payment|delivery|shipping|оплат|доставк|корзин|заказ|оферт|услови|покупк|приобретени)/i.test(
      text
    );
  });
}

function hasReturnRefundContext(evidencePackage: SemanticEvidenceExcerpt[]): boolean {
  return evidencePackage.some((item) => {
    const text = `${item.pageUrl ?? ""} ${item.excerpt}`.toLowerCase();
    return /(return|refund|returns|возврат|возмещ|отказ\s+от\s+товар|обмен)/i.test(text);
  });
}

function hasExplicitReturnContradictionSignal(evidencePackage: SemanticEvidenceExcerpt[]): boolean {
  return evidencePackage.some((item) => {
    const text = item.excerpt.toLowerCase();
    return [
      /расход[а-яё\s]*(?:по|на)\s+возврат[а-яё\s]*(?:всегда\s+)?(?:нес[её]т|оплачивает)\s+потребител/,
      /потребител[а-яё\s]*(?:всегда\s+)?(?:нес[её]т|оплачивает)[а-яё\s]*расход[а-яё\s]*(?:по|на)\s+возврат/,
      /стоимость\s+возврат[а-яё\s]*не\s+возмещ/,
      /возврат[а-яё\s]*(?:невозможен|не\s+принимается|запрещ[её]н)\s+при\s+любых\s+условиях/,
      /return\s+shipping\s+is\s+always\s+paid\s+by\s+the\s+consumer/,
      /refunds?\s+are\s+not\s+available\s+under\s+any\s+circumstances/
    ].some((pattern) => pattern.test(text));
  });
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

function recommendationRulesDocumentAccessBridge(
  rule: Rule,
  input: EvaluateSemanticShadowRulesInput
): SemanticShadowEvaluation | undefined {
  if (rule.ruleId !== "REC-003") {
    return undefined;
  }
  if (!hasTruthyFact(input.facts, "recommendation_technology_confirmed")) {
    return undefined;
  }

  const documentFactIds = new Set(
    input.facts
      .filter((fact) => fact.factType === "recommendation_rules_document_link" && fact.value.found === true)
      .map((fact) => fact.id)
  );
  if (documentFactIds.size === 0) {
    return undefined;
  }

  const evidenceRefs = input.evidence
    .filter((evidence) => evidence.factId && documentFactIds.has(evidence.factId))
    .map((evidence) => `recommendation_rules_document_link:${evidence.id}`);

  const result: SemanticEvaluation = {
    status: "MANUAL_CHECK",
    observation: "AMBIGUOUS",
    confidence: 0.5,
    reasonCode: "RECOMMENDATION_RULES_DOCUMENT_TEXT_UNAVAILABLE",
    reason: "A recommendation-technology rules document link exists, but accessible rules text was not available for semantic evaluation.",
    evidenceRefs
  };

  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.version,
    status: result.status,
    criterion: rule.evaluation.kind === "SEMANTIC_CRITERION" ? rule.evaluation.criterion : "",
    evidenceRefs,
    result
  };
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
    maxChars: fact.value.maxChars,
    serviceName: fact.value.service_name,
    serviceCategory: fact.value.category,
    signalType: fact.value.signal_type,
    matchedHost: fact.value.matched_host,
    cookieNames: fact.value.cookieNames,
    storageKeys: fact.value.keys,
    hosts: fact.value.hosts
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

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
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

function guardCookiePolicyCompletenessFail(
  ruleId: string,
  result: SemanticEvaluationResult,
  evidencePackage: SemanticEvidenceExcerpt[]
): SemanticEvaluationResult {
  if (ruleId !== "CK-001" || result.status !== "FAIL") {
    return result;
  }

  const hasCompletePolicy = evidencePackage.some(
    (item) => item.metadata?.factType === "privacy_policy_text" && item.completeness === "COMPLETE"
  );
  if (hasCompletePolicy) {
    return result;
  }

  const guarded: SemanticEvaluation = {
    status: "MANUAL_CHECK",
    observation: result.observation,
    confidence: Math.min(result.confidence, 0.5),
    reasonCode: "COOKIE_POLICY_EVIDENCE_REQUIRES_MANUAL_CHECK",
    reason: "Cookie disclosure evidence is incomplete, so shadow mode cannot produce an absence-based FAIL.",
    evidenceRefs: result.evidenceRefs
  };
  return guarded;
}

function guardEc016ContradictionFail(
  ruleId: string,
  result: SemanticEvaluationResult,
  evidencePackage: SemanticEvidenceExcerpt[]
): SemanticEvaluationResult {
  if (ruleId !== "EC-016" || result.status !== "FAIL" || hasExplicitReturnContradictionSignal(evidencePackage)) {
    return result;
  }

  const guarded: SemanticEvaluation = {
    status: "MANUAL_CHECK",
    observation: result.observation,
    confidence: Math.min(result.confidence, 0.5),
    reasonCode: "RETURN_TERMS_CONTRADICTION_REQUIRES_MANUAL_CHECK",
    reason: "Return/refund evidence did not contain an explicit contradiction signal, so absence-based FAIL was downgraded.",
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
