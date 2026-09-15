import type { Fact } from "@/facts/types";
import type {
  OwnerAnswer,
  OwnerAnswerValue,
  OwnerApplicabilityStatus,
  OwnerContextInput,
  OwnerEvaluationStatus,
  OwnerReasonCode,
  OwnerRuleEvaluation,
  OwnerRuleMapping,
  SiteFactRef
} from "./types";

const VALID_BASIS_OPTIONS = new Set([
  "SEPARATE_CONSENT",
  "CONTRACT_OR_REQUEST",
  "LEGAL_REQUIREMENT",
  "OTHER_CONFIRMED_BASIS"
]);

const MARKETING_SIGNAL_FACTS = new Set([
  "marketing_subscription_detected",
  "rendered_marketing_consent_found"
]);

const PD_COLLECTION_FACTS = new Set([
  "personal_data_collection_found",
  "rendered_personal_data_collection_found"
]);

const AUTH_SIGNAL_FACTS = new Set([
  "auth_ui_static_signal",
  "auth_provider_candidates_rendered"
]);

const AD_SIGNAL_FACTS = new Set([
  "ad_candidate_detected",
  "ad_label_text_found",
  "erid_token_candidate"
]);

const RECOMMENDER_SIGNAL_FACTS = new Set([
  "recommendation_technology_suspected",
  "recommendation_notice_candidate",
  "recommendation_rules_document_link"
]);

const LANGUAGE_SIGNAL_FACTS = new Set([
  "public_non_ad_consumer_info_foreign_only",
  "page_language_signal"
]);

export const OWNER_RULE_MAPPINGS: OwnerRuleMapping[] = [
  {
    ruleId: "PD-007",
    questionIds: ["Q_PD_COLLECTION_LEGAL_BASIS"],
    evaluate: (context) => evaluatePdLegalBasis("PD-007", context)
  },
  {
    ruleId: "PD-012",
    questionIds: ["Q_MARKETING_CONSENT_PROOF"],
    evaluate: (context) => evaluateMarketingConsent("PD-012", context)
  },
  {
    ruleId: "PD-022",
    questionIds: ["Q_PD_PRIMARY_DB_LOCATION"],
    legallyAmbiguous: true,
    evaluate: (context) => evaluatePrimaryDbLocation(context)
  },
  {
    ruleId: "PD-023",
    questionIds: ["Q_PD_OPERATOR_RKN_NOTIFICATION"],
    legallyAmbiguous: true,
    evaluate: (context) => evaluateRknNotification(context)
  },
  {
    ruleId: "ADV-001",
    questionIds: ["Q_AD_MATERIAL_QUALIFICATION"],
    legallyAmbiguous: true,
    evaluate: (context) => evaluateAdRule("ADV-001", "ad_label_text_found", context)
  },
  {
    ruleId: "ADV-002",
    questionIds: ["Q_AD_MATERIAL_QUALIFICATION"],
    legallyAmbiguous: true,
    evaluate: (context) => evaluateAdRule("ADV-002", "advertiser_identity_or_link_found", context)
  },
  {
    ruleId: "ADV-003",
    questionIds: ["Q_AD_MATERIAL_QUALIFICATION"],
    legallyAmbiguous: true,
    evaluate: (context) => evaluateAdRule("ADV-003", "erid_token_candidate", context)
  },
  {
    ruleId: "ADV-004",
    questionIds: ["Q_MARKETING_CONSENT_PROOF"],
    evaluate: (context) => evaluateMarketingConsent("ADV-004", context)
  },
  {
    ruleId: "AUTH-001",
    questionIds: ["Q_AUTH_OWNER_STATUS", "Q_AUTH_METHODS"],
    legallyAmbiguous: true,
    evaluate: evaluateAuth
  },
  {
    ruleId: "REC-001",
    questionIds: ["Q_RECOMMENDER_TECH_USE"],
    legallyAmbiguous: true,
    evaluate: (context) => evaluateRecommenderRule("REC-001", "recommendation_notice_candidate", context)
  },
  {
    ruleId: "REC-002",
    questionIds: ["Q_RECOMMENDER_TECH_USE"],
    legallyAmbiguous: true,
    evaluate: (context) => evaluateRecommenderRule("REC-002", "recommendation_rules_document_link", context)
  },
  {
    ruleId: "REC-004",
    questionIds: ["Q_RECOMMENDER_TECH_USE"],
    legallyAmbiguous: true,
    evaluate: (context) => evaluateRecommenderRule("REC-004", "owner_contact_for_recommender_requirements_missing", context)
  },
  {
    ruleId: "LANG-002",
    questionIds: ["Q_LANGUAGE_EXCEPTION"],
    legallyAmbiguous: true,
    evaluate: evaluateLanguageException
  }
];

export function evaluateOwnerRules(context: OwnerContextInput): OwnerRuleEvaluation[] {
  return OWNER_RULE_MAPPINGS.map((mapping) => withOutputContract(mapping.evaluate(context), context));
}

export function getOwnerQuestionApplicability(
  questionId: string,
  context: OwnerContextInput
): OwnerApplicabilityStatus {
  switch (questionId) {
    case "Q_PD_COLLECTION_LEGAL_BASIS":
    case "Q_PD_PRIMARY_DB_LOCATION":
      return hasPositiveFact(context.facts, PD_COLLECTION_FACTS) ? "REQUIRED" : "NOT_NEEDED";
    case "Q_MARKETING_CONSENT_PROOF":
      return hasPositiveFact(context.facts, MARKETING_SIGNAL_FACTS) ? "REQUIRED" : "NOT_NEEDED";
    case "Q_PD_OPERATOR_RKN_NOTIFICATION":
      return hasPositiveFact(context.facts, PD_COLLECTION_FACTS) && hasOperatorCandidate(context.facts)
        ? "REQUIRED"
        : "UNRESOLVED";
    case "Q_AD_MATERIAL_QUALIFICATION":
      return hasPositiveFact(context.facts, AD_SIGNAL_FACTS) ? "REQUIRED" : "UNRESOLVED";
    case "Q_AUTH_OWNER_STATUS":
      return hasAnyFact(context.facts, AUTH_SIGNAL_FACTS) ? "REQUIRED" : "NOT_NEEDED";
    case "Q_AUTH_METHODS":
      return authMethodsApplicability(context);
    case "Q_RECOMMENDER_TECH_USE":
      return hasAnyFact(context.facts, RECOMMENDER_SIGNAL_FACTS) ? "REQUIRED" : "UNRESOLVED";
    case "Q_LANGUAGE_EXCEPTION":
      if (!["B2C_SERVICE", "ECOMMERCE"].includes(context.siteType)) {
        return "NOT_NEEDED";
      }
      return hasPositiveFact(context.facts, new Set(["public_non_ad_consumer_info_foreign_only"]))
        ? "REQUIRED"
        : "UNRESOLVED";
    default:
      throw new Error(`Unknown owner question: ${questionId}`);
  }
}

export function getRequiredOwnerQuestions(context: OwnerContextInput): string[] {
  const required = new Set<string>();
  for (const mapping of OWNER_RULE_MAPPINGS) {
    for (const questionId of mapping.questionIds) {
      if (getOwnerQuestionApplicability(questionId, context) === "REQUIRED") {
        required.add(questionId);
      }
    }
  }
  return [...required];
}

function evaluatePdLegalBasis(ruleId: string, context: OwnerContextInput): OwnerRuleEvaluation {
  const applicability = getOwnerQuestionApplicability("Q_PD_COLLECTION_LEGAL_BASIS", context);
  if (applicability !== "REQUIRED") {
    return applicabilityResult(ruleId, ["Q_PD_COLLECTION_LEGAL_BASIS"], applicability);
  }

  const pdContextKeys = pdCollectionContextKeys(context.facts);
  const answers = pdContextKeys.map(
    (contextKey) =>
      answerFor(context, "Q_PD_COLLECTION_LEGAL_BASIS", contextKey) ??
      (pdContextKeys.length === 1 ? answerFor(context, "Q_PD_COLLECTION_LEGAL_BASIS", "") : undefined)
  );
  const siteRefs = refs(context.facts, PD_COLLECTION_FACTS);
  if (answers.some((answer) => !answer)) {
    return answerRequired(ruleId, ["Q_PD_COLLECTION_LEGAL_BASIS"]);
  }
  for (const answer of answers) {
    if (!answer) {
      continue;
    }
    if ("unknown" in answer.answer) {
      return manual(ruleId, ["Q_PD_COLLECTION_LEGAL_BASIS"], "OWNER_UNKNOWN", answer.answer, siteRefs);
    }
    const option = singleOption(answer.answer);
    if (option === "NO_PD_PROCESSING") {
      return conflict(ruleId, ["Q_PD_COLLECTION_LEGAL_BASIS"], answer.answer, siteRefs);
    }
    if (option === "NO_BASIS") {
      return evaluated(ruleId, ["Q_PD_COLLECTION_LEGAL_BASIS"], "FAIL", answer.answer, siteRefs, "Владелец указал, что правового основания обработки нет.");
    }
    if (!VALID_BASIS_OPTIONS.has(option)) {
      return manual(ruleId, ["Q_PD_COLLECTION_LEGAL_BASIS"], "OWNER_UNKNOWN", answer.answer, siteRefs);
    }
  }
  return evaluated(ruleId, ["Q_PD_COLLECTION_LEGAL_BASIS"], "PASS", answers[0]!.answer, siteRefs, "Владелец указал правовое основание обработки для всех найденных форм.");
}

function evaluateMarketingConsent(ruleId: string, context: OwnerContextInput): OwnerRuleEvaluation {
  const questionIds = ["Q_MARKETING_CONSENT_PROOF"];
  const applicability = getOwnerQuestionApplicability("Q_MARKETING_CONSENT_PROOF", context);
  if (applicability !== "REQUIRED") {
    return applicabilityResult(ruleId, questionIds, applicability);
  }

  const answer = answerFor(context, "Q_MARKETING_CONSENT_PROOF");
  const siteRefs = refs(context.facts, MARKETING_SIGNAL_FACTS);
  if (!answer) {
    return answerRequired(ruleId, questionIds);
  }
  if ("unknown" in answer.answer) {
    return manual(ruleId, questionIds, "OWNER_UNKNOWN", answer.answer, siteRefs);
  }

  const option = singleOption(answer.answer);
  if (option === "NO_MARKETING" && hasPositiveFact(context.facts, MARKETING_SIGNAL_FACTS)) {
    return conflict(ruleId, questionIds, answer.answer, siteRefs);
  }
  if (option === "PROOF_STORED") {
    return evaluated(ruleId, questionIds, "PASS", answer.answer, siteRefs, "Владелец указал, что согласие на маркетинг фиксируется и может быть подтверждено.");
  }
  if (option === "NO_PROOF") {
    return evaluated(ruleId, questionIds, "FAIL", answer.answer, siteRefs, "Владелец указал, что доказательство предварительного согласия не фиксируется.");
  }
  return manual(ruleId, questionIds, "RULE_POLICY_REQUIRES_MANUAL_CHECK", answer.answer, siteRefs);
}

function evaluatePrimaryDbLocation(context: OwnerContextInput): OwnerRuleEvaluation {
  const ruleId = "PD-022";
  const questionIds = ["Q_PD_PRIMARY_DB_LOCATION"];
  const applicability = getOwnerQuestionApplicability("Q_PD_PRIMARY_DB_LOCATION", context);
  if (applicability !== "REQUIRED") {
    return applicabilityResult(ruleId, questionIds, applicability);
  }

  const answer = answerFor(context, "Q_PD_PRIMARY_DB_LOCATION");
  const siteRefs = refs(context.facts, PD_COLLECTION_FACTS);
  if (!answer) {
    return answerRequired(ruleId, questionIds);
  }
  if ("unknown" in answer.answer) {
    return manual(ruleId, questionIds, "OWNER_UNKNOWN", answer.answer, siteRefs);
  }

  const option = singleOption(answer.answer);
  if (option === "RU_FIRST" || option === "RU_FIRST_FOREIGN_COPIES") {
    return evaluated(ruleId, questionIds, "PASS", answer.answer, siteRefs, "Владелец указал, что первичная запись базы ПД происходит в России.");
  }
  return manual(ruleId, questionIds, "RULE_POLICY_REQUIRES_MANUAL_CHECK", answer.answer, siteRefs);
}

function evaluateRknNotification(context: OwnerContextInput): OwnerRuleEvaluation {
  const ruleId = "PD-023";
  const questionIds = ["Q_PD_OPERATOR_RKN_NOTIFICATION"];
  const applicability = getOwnerQuestionApplicability("Q_PD_OPERATOR_RKN_NOTIFICATION", context);
  if (applicability !== "REQUIRED") {
    return applicabilityResult(ruleId, questionIds, applicability);
  }

  const answer = answerFor(context, "Q_PD_OPERATOR_RKN_NOTIFICATION");
  const siteRefs = refs(context.facts, new Set(["seller_legal_name_candidate", "ogrn_candidate", "ogrnip_candidate"]));
  if (!answer) {
    return answerRequired(ruleId, questionIds);
  }
  if ("unknown" in answer.answer) {
    return manual(ruleId, questionIds, "OWNER_UNKNOWN", answer.answer, siteRefs);
  }

  const option = singleOption(answer.answer);
  if (option === "REGISTRY_PRESENT" || option === "SUBMITTED_NOT_LISTED") {
    return manual(ruleId, questionIds, "RULE_POLICY_REQUIRES_MANUAL_CHECK", answer.answer, siteRefs);
  }
  if (option === "NOT_SUBMITTED") {
    return evaluated(ruleId, questionIds, "WARNING", answer.answer, siteRefs, "Владелец указал, что уведомление не подано.");
  }
  return manual(ruleId, questionIds, "RULE_POLICY_REQUIRES_MANUAL_CHECK", answer.answer, siteRefs);
}

function evaluateAdRule(ruleId: string, missingFactType: string, context: OwnerContextInput): OwnerRuleEvaluation {
  const questionIds = ["Q_AD_MATERIAL_QUALIFICATION"];
  const applicability = getOwnerQuestionApplicability("Q_AD_MATERIAL_QUALIFICATION", context);
  if (applicability !== "REQUIRED") {
    return applicabilityResult(ruleId, questionIds, applicability);
  }

  const answer = answerFor(context, "Q_AD_MATERIAL_QUALIFICATION");
  const siteRefs = refs(context.facts, AD_SIGNAL_FACTS);
  if (!answer) {
    return answerRequired(ruleId, questionIds);
  }
  if ("unknown" in answer.answer) {
    return manual(ruleId, questionIds, "OWNER_UNKNOWN", answer.answer, siteRefs);
  }

  const option = singleOption(answer.answer);
  if (option === "NOT_AD" && hasPositiveFact(context.facts, new Set(["ad_label_text_found", "erid_token_candidate"]))) {
    return conflict(ruleId, questionIds, answer.answer, siteRefs);
  }
  if (option === "NOT_AD") {
    return evaluated(ruleId, questionIds, "NOT_APPLICABLE", answer.answer, siteRefs, "Владелец указал, что отмеченный блок не является интернет-рекламой.");
  }
  if (ruleId === "ADV-003" || hasPositiveFalseFact(context.facts, missingFactType)) {
    return manual(ruleId, questionIds, "RULE_POLICY_REQUIRES_MANUAL_CHECK", answer.answer, siteRefs);
  }
  return evaluated(ruleId, questionIds, "UNRESOLVED", answer.answer, siteRefs, "Нужен отдельный detector для недостающих признаков рекламной маркировки.");
}

function evaluateAuth(context: OwnerContextInput): OwnerRuleEvaluation {
  const questionIds = ["Q_AUTH_OWNER_STATUS", "Q_AUTH_METHODS"];
  const ownerApplicability = getOwnerQuestionApplicability("Q_AUTH_OWNER_STATUS", context);
  if (ownerApplicability !== "REQUIRED") {
    return applicabilityResult("AUTH-001", questionIds, ownerApplicability);
  }

  const ownerAnswer = answerFor(context, "Q_AUTH_OWNER_STATUS");
  const siteRefs = refs(context.facts, AUTH_SIGNAL_FACTS);
  if (!ownerAnswer) {
    return answerRequired("AUTH-001", ["Q_AUTH_OWNER_STATUS"]);
  }
  if ("unknown" in ownerAnswer.answer) {
    return manual("AUTH-001", ["Q_AUTH_OWNER_STATUS"], "OWNER_UNKNOWN", ownerAnswer.answer, siteRefs);
  }

  if (singleOption(ownerAnswer.answer) === "NOT_RUSSIAN_OWNER") {
    return evaluated("AUTH-001", ["Q_AUTH_OWNER_STATUS"], "NOT_APPLICABLE", ownerAnswer.answer, siteRefs, "Владелец указал, что ресурс не принадлежит российскому лицу.");
  }

  const methodsApplicability = getOwnerQuestionApplicability("Q_AUTH_METHODS", context);
  if (methodsApplicability !== "REQUIRED") {
    return applicabilityResult("AUTH-001", ["Q_AUTH_METHODS"], methodsApplicability);
  }

  const methodsAnswer = answerFor(context, "Q_AUTH_METHODS");
  if (!methodsAnswer) {
    return answerRequired("AUTH-001", ["Q_AUTH_METHODS"]);
  }
  if ("unknown" in methodsAnswer.answer) {
    return manual("AUTH-001", ["Q_AUTH_METHODS"], "OWNER_UNKNOWN", methodsAnswer.answer, siteRefs);
  }

  const options = multiOptions(methodsAnswer.answer);
  if (options.has("NO_AUTH") && hasAnyFact(context.facts, AUTH_SIGNAL_FACTS)) {
    return conflict("AUTH-001", ["Q_AUTH_METHODS"], methodsAnswer.answer, siteRefs);
  }
  if (options.has("ESIA") || options.has("ALLOWED_RU_METHOD")) {
    return evaluated("AUTH-001", questionIds, "PASS", methodsAnswer.answer, siteRefs, "Владелец указал допустимый способ авторизации.");
  }
  if (options.has("NO_AUTH")) {
    return evaluated("AUTH-001", questionIds, "NOT_APPLICABLE", methodsAnswer.answer, siteRefs, "Владелец указал, что авторизации нет.");
  }
  return manual("AUTH-001", questionIds, "RULE_POLICY_REQUIRES_MANUAL_CHECK", methodsAnswer.answer, siteRefs);
}

function evaluateRecommenderRule(ruleId: string, supportingFactType: string, context: OwnerContextInput): OwnerRuleEvaluation {
  const questionIds = ["Q_RECOMMENDER_TECH_USE"];
  const applicability = getOwnerQuestionApplicability("Q_RECOMMENDER_TECH_USE", context);
  if (applicability !== "REQUIRED") {
    return applicabilityResult(ruleId, questionIds, applicability);
  }

  const answer = answerFor(context, "Q_RECOMMENDER_TECH_USE");
  const siteRefs = refs(context.facts, RECOMMENDER_SIGNAL_FACTS);
  if (!answer) {
    return answerRequired(ruleId, questionIds);
  }
  if ("unknown" in answer.answer) {
    return manual(ruleId, questionIds, "OWNER_UNKNOWN", answer.answer, siteRefs);
  }

  const option = singleOption(answer.answer);
  if ((option === "NO_RECOMMENDER_TECH" || option === "BASIC_SORTING_ONLY") && hasPositiveFact(context.facts, RECOMMENDER_SIGNAL_FACTS)) {
    return conflict(ruleId, questionIds, answer.answer, siteRefs);
  }
  if (option === "NO_RECOMMENDER_TECH" || option === "BASIC_SORTING_ONLY") {
    return evaluated(ruleId, questionIds, "NOT_APPLICABLE", answer.answer, siteRefs, "Владелец указал, что рекомендательные технологии не используются.");
  }
  if (hasPositiveFalseFact(context.facts, supportingFactType)) {
    return manual(ruleId, questionIds, "RULE_POLICY_REQUIRES_MANUAL_CHECK", answer.answer, siteRefs);
  }
  return evaluated(ruleId, questionIds, "UNRESOLVED", answer.answer, siteRefs, "Нужны detector/document facts для финальной оценки правила.");
}

function evaluateLanguageException(context: OwnerContextInput): OwnerRuleEvaluation {
  const ruleId = "LANG-002";
  const questionIds = ["Q_LANGUAGE_EXCEPTION"];
  const applicability = getOwnerQuestionApplicability("Q_LANGUAGE_EXCEPTION", context);
  if (applicability !== "REQUIRED") {
    return applicabilityResult(ruleId, questionIds, applicability);
  }

  const answer = answerFor(context, "Q_LANGUAGE_EXCEPTION");
  const siteRefs = refs(context.facts, LANGUAGE_SIGNAL_FACTS);
  if (!answer) {
    return answerRequired(ruleId, questionIds);
  }
  if ("unknown" in answer.answer) {
    return manual(ruleId, questionIds, "OWNER_UNKNOWN", answer.answer, siteRefs);
  }

  const option = singleOption(answer.answer);
  if (option === "NO_EXCEPTION") {
    return evaluated(ruleId, questionIds, "WARNING", answer.answer, siteRefs, "Владелец указал, что исключение не применяется.");
  }
  return evaluated(ruleId, questionIds, "NOT_APPLICABLE", answer.answer, siteRefs, "Владелец указал возможное исключение из языкового требования.");
}

function authMethodsApplicability(context: OwnerContextInput): OwnerApplicabilityStatus {
  if (!hasAnyFact(context.facts, AUTH_SIGNAL_FACTS)) {
    return "NOT_NEEDED";
  }
  const ownerAnswer = answerFor(context, "Q_AUTH_OWNER_STATUS");
  if (!ownerAnswer || "unknown" in ownerAnswer.answer) {
    return "UNRESOLVED";
  }
  return singleOption(ownerAnswer.answer) === "RUSSIAN_OWNER" ? "REQUIRED" : "NOT_NEEDED";
}

function answerFor(context: OwnerContextInput, questionId: string, contextKey = ""): OwnerAnswer | undefined {
  return context.answers.find((answer) => answer.questionId === questionId && (answer.contextKey ?? "") === contextKey);
}

function singleOption(answer: OwnerAnswerValue): string {
  if ("unknown" in answer || answer.type !== "SINGLE_SELECT") {
    throw new Error("Expected SINGLE_SELECT owner answer");
  }
  return answer.optionId;
}

function multiOptions(answer: OwnerAnswerValue): Set<string> {
  if ("unknown" in answer || answer.type !== "MULTI_SELECT") {
    throw new Error("Expected MULTI_SELECT owner answer");
  }
  return new Set(answer.optionIds);
}

function hasOperatorCandidate(facts: Fact[]): boolean {
  return hasAnyFact(facts, new Set(["seller_legal_name_candidate", "ogrn_candidate", "ogrnip_candidate"]));
}

function hasAnyFact(facts: Fact[], factTypes: Set<string>): boolean {
  return facts.some((fact) => factTypes.has(fact.factType));
}

function hasPositiveFact(facts: Fact[], factTypes: Set<string>): boolean {
  return facts.some((fact) => factTypes.has(fact.factType) && factIsPositive(fact));
}

function hasPositiveFalseFact(facts: Fact[], factType: string): boolean {
  return facts.some((fact) => fact.factType === factType && (fact.value.found === false || fact.value.detected === false));
}

function factIsPositive(fact: Fact): boolean {
  if (fact.value.found === false || fact.value.detected === false) {
    return false;
  }
  return fact.value.found === true || fact.value.detected === true || fact.value.candidate === true || Object.keys(fact.value).length > 0;
}

function pdCollectionContextKeys(facts: Fact[]): string[] {
  const keys = facts
    .filter((fact) => PD_COLLECTION_FACTS.has(fact.factType) && factIsPositive(fact))
    .map((fact) => String(fact.value.contextKey ?? normalizedPage(fact.pageUrl) ?? fact.id));
  return [...new Set(keys)];
}

function normalizedPage(pageUrl: string | undefined): string | undefined {
  if (!pageUrl) {
    return undefined;
  }
  try {
    const url = new URL(pageUrl);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return pageUrl;
  }
}

function refs(facts: Fact[], factTypes: Set<string>): SiteFactRef[] {
  return facts
    .filter((fact) => factTypes.has(fact.factType))
    .map((fact) => ({ factId: fact.id, factType: fact.factType, pageUrl: fact.pageUrl }));
}

function applicabilityResult(
  ruleId: string,
  questionIds: string[],
  applicability: OwnerApplicabilityStatus
): OwnerRuleEvaluation {
  if (applicability === "NOT_NEEDED") {
    return {
      ruleId,
      applicability: "NOT_NEEDED",
      status: "NOT_APPLICABLE",
      questionIds,
      ownerAnswerRefs: [],
      siteEvidenceRefs: [],
      siteFactRefs: [],
      conflictDetected: false,
      explanation: "Owner context для этого правила не нужен по текущим site facts."
    };
  }
  return {
    ruleId,
    applicability: "UNRESOLVED",
    status: "UNRESOLVED",
    questionIds,
    reasonCode: "APPLICABILITY_UNRESOLVED",
    ownerAnswerRefs: [],
    siteEvidenceRefs: [],
    siteFactRefs: [],
    conflictDetected: false,
    explanation: "Применимость правила зависит от ещё не подтверждённых facts/evidence."
  };
}

function answerRequired(ruleId: string, questionIds: string[]): OwnerRuleEvaluation {
  return {
    ruleId,
    applicability: "REQUIRED",
    status: "UNRESOLVED",
    questionIds,
    reasonCode: "ANSWER_REQUIRED",
    ownerAnswerRefs: [],
    siteEvidenceRefs: [],
    siteFactRefs: [],
    conflictDetected: false,
    explanation: "Для оценки правила нужен обязательный owner answer."
  };
}

function manual(
  ruleId: string,
  questionIds: string[],
  reasonCode: OwnerReasonCode,
  ownerAnswer: OwnerAnswerValue,
  siteFactRefs: SiteFactRef[]
): OwnerRuleEvaluation {
  return evaluated(ruleId, questionIds, "MANUAL_CHECK", ownerAnswer, siteFactRefs, "Ответ владельца требует ручной проверки.", reasonCode);
}

function conflict(
  ruleId: string,
  questionIds: string[],
  ownerAnswer: OwnerAnswerValue,
  siteFactRefs: SiteFactRef[]
): OwnerRuleEvaluation {
  return evaluated(
    ruleId,
    questionIds,
    "MANUAL_CHECK",
    ownerAnswer,
    siteFactRefs,
    "Ответ владельца противоречит фактам, обнаруженным публичным сканированием.",
    "OWNER_ANSWER_CONFLICTS_WITH_SITE_EVIDENCE"
  );
}

function evaluated(
  ruleId: string,
  questionIds: string[],
  status: OwnerEvaluationStatus,
  ownerAnswer: OwnerAnswerValue,
  siteFactRefs: SiteFactRef[],
  explanation: string,
  reasonCode?: OwnerReasonCode
): OwnerRuleEvaluation {
  return {
    ruleId,
    applicability: "REQUIRED",
    status,
    questionIds,
    reasonCode,
    ownerAnswer,
    ownerAnswerRefs: [],
    siteEvidenceRefs: siteFactRefs,
    siteFactRefs,
    conflictDetected: reasonCode === "OWNER_ANSWER_CONFLICTS_WITH_SITE_EVIDENCE",
    explanation
  };
}

function withOutputContract(evaluation: OwnerRuleEvaluation, context: OwnerContextInput): OwnerRuleEvaluation {
  const ownerAnswerRefs = context.answers
    .filter((answer) => evaluation.questionIds.includes(answer.questionId))
    .map((answer) => ({ questionId: answer.questionId, answerId: answer.id }));

  return {
    ...evaluation,
    ownerAnswerRefs,
    siteEvidenceRefs: evaluation.siteFactRefs,
    conflictDetected: evaluation.reasonCode === "OWNER_ANSWER_CONFLICTS_WITH_SITE_EVIDENCE"
  };
}
