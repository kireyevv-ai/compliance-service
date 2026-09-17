import type { Scan } from "@/db/schema";
import type { Evidence } from "@/evidence/types";
import type { Fact } from "@/facts/types";
import type { Rule, RuleEvaluation, RuleEvaluationResult } from "./types";

type FactIndex = {
  facts: Fact[];
  evidenceByFactId: Map<string, Evidence[]>;
};

type BuiltinEvaluation =
  | { status: "PASS"; evidenceFactTypes?: string[]; evidenceIds?: string[]; explanation: string; summary?: string }
  | { status: RuleEvaluation["status"]; evidenceFactTypes: string[]; evidenceIds?: string[]; explanation: string; summary?: string }
  | { status: "NO_EVALUATION"; reason: string };

export function evaluateRulesForScan(input: {
  scan: Scan;
  facts: Fact[];
  evidence: Evidence[];
  rules: Rule[];
}): RuleEvaluationResult[] {
  const index = buildFactIndex(input.facts, input.evidence);
  return input.rules.map((rule) => evaluateRule(input.scan, rule, index));
}

export function evaluateRule(scan: Scan, rule: Rule, index: FactIndex): RuleEvaluationResult {
  if (rule.evaluatorType !== "DETERMINISTIC") {
    return noEvaluation(rule, `Unsupported evaluator_type=${rule.evaluatorType}`);
  }

  if (rule.evaluation.kind !== "FACT_PATTERN") {
    return noEvaluation(rule, `Unsupported deterministic evaluation kind=${rule.evaluation.kind}`);
  }

  if (!rule.appliesTo.includes(scan.siteType)) {
    return noEvaluation(rule, `Rule does not apply to site_type=${scan.siteType}`);
  }

  const sellerApplicabilityReason = sellerApplicabilityBlockReason(rule.ruleId, index);
  if (sellerApplicabilityReason) {
    return noEvaluation(rule, sellerApplicabilityReason);
  }

  const missingFacts = rule.requiredFacts.filter((factType) => !hasFact(index, factType));
  if (missingFacts.length > 0) {
    return noEvaluation(rule, `Required facts are missing: ${missingFacts.join(", ")}`);
  }

  const builtin = String(rule.evaluation.conditions.builtin ?? rule.ruleId);
  const result = evaluateBuiltin(builtin, index);

  if (result.status === "NO_EVALUATION") {
    return noEvaluation(rule, result.reason);
  }

  const evidenceIds = unique([...collectEvidenceIds(index, result.evidenceFactTypes ?? []), ...(result.evidenceIds ?? [])]);
  if ((result.status === "FAIL" || result.status === "WARNING") && evidenceIds.length === 0) {
    return noEvaluation(rule, "Triggered result has no supporting evidence");
  }

  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.version,
    status: result.status,
    severity: rule.severity,
    confidence: confidence(rule),
    summary: result.summary ?? summaryFor(rule, result.status),
    explanation: result.explanation,
    remediation: rule.remediation,
    evidenceIds,
    missingContext: []
  };
}

function evaluateBuiltin(ruleId: string, index: FactIndex): BuiltinEvaluation {
  switch (ruleId) {
    case "PD-001":
      return evaluatePd001(index);
    case "PD-002":
      return evaluateAccessibility(index, "policy_url_accessible", {
        fail: "На сайте найдена ссылка на политику обработки персональных данных, но URL политики недоступен или возвращает ошибку.",
        pass: "Ссылка на политику обработки персональных данных доступна по результату Basic Crawler."
      });
    case "PD-003":
      return evaluatePd003(index);
    case "PD-006":
      return evaluatePd006(index);
    case "PD-011":
      return evaluatePd011(index);
    case "EC-001":
      return evaluateEc001(index);
    case "EC-002":
      return evaluateAccessibility(index, "offer_accessible", {
        fail: "На сайте найдена ссылка на оферту, но URL оферты недоступен или возвращает ошибку.",
        pass: "Ссылка на оферту доступна по результату Basic Crawler."
      });
    case "EC-003":
      return evaluateSellerMissing(index, "LEGAL_ENTITY", "legal_name_found", {
        fail: "У российского юрлица-продавца не обнаружено полное фирменное наименование.",
        pass: "У российского юрлица-продавца обнаружено полное фирменное наименование."
      });
    case "EC-004":
      return evaluateSellerMissing(index, "LEGAL_ENTITY", "ogrn_found", {
        fail: "У российского юрлица-продавца не обнаружен ОГРН.",
        pass: "У российского юрлица-продавца обнаружен ОГРН."
      });
    case "EC-005":
      return evaluateSellerMissing(index, "LEGAL_ENTITY", "seller_address_found", {
        fail: "У российского юрлица-продавца не обнаружены адрес и место нахождения.",
        pass: "У российского юрлица-продавца обнаружен адрес."
      });
    case "EC-006":
      return evaluateSellerContactMissing(index, "LEGAL_ENTITY", "FAIL", {
        fail: "У российского юрлица-продавца не обнаружены ни e-mail, ни телефон.",
        pass: "У российского юрлица-продавца обнаружен e-mail или телефон."
      });
    case "EC-007":
      return evaluateSellerMissing(index, "INDIVIDUAL_ENTREPRENEUR", "seller_fio_found", {
        fail: "У продавца-ИП не обнаружены ФИО.",
        pass: "У продавца-ИП обнаружены ФИО."
      });
    case "EC-008":
      return evaluateSellerMissing(index, "INDIVIDUAL_ENTREPRENEUR", "ogrnip_found", {
        fail: "У продавца-ИП не обнаружен ОГРНИП.",
        pass: "У продавца-ИП обнаружен ОГРНИП."
      });
    case "EC-009":
      return evaluateSellerContactMissing(index, "INDIVIDUAL_ENTREPRENEUR", "FAIL", {
        fail: "У продавца-ИП не обнаружены ни e-mail, ни телефон.",
        pass: "У продавца-ИП обнаружен e-mail или телефон."
      });
    case "EC-011":
      return evaluateEc011(index);
    case "EC-013":
      return evaluateEc013(index);
    case "CON-001":
      return evaluateCon001(index);
    case "CON-002":
      return evaluateCon002(index);
    default:
      return noBuiltin(`No evaluator registered for ${ruleId}`);
  }
}

function evaluatePd001(index: FactIndex): BuiltinEvaluation {
  const pdCollection = boolFact(index, "personal_data_collection_found");
  const policyFound = boolFact(index, "privacy_policy_link_found");
  if (pdCollection === undefined || policyFound === undefined) {
    return noBuiltin("Personal-data collection or policy search result is not fully known");
  }
  if (pdCollection && policyFound) {
    return {
      status: "PASS",
      evidenceFactTypes: ["personal_data_collection_found", "privacy_policy_link_found"],
      summary: "Политика обработки персональных данных найдена.",
      explanation: "На страницах, где обнаружен сбор персональных данных, найдена ссылка на политику обработки персональных данных."
    };
  }
  if (pdCollection && !policyFound) {
    if (!completeCoverage(index)) {
      return noBuiltin("Crawl coverage is incomplete; policy absence cannot be concluded");
    }
    return {
      status: "FAIL",
      evidenceFactTypes: ["personal_data_collection_found", "privacy_policy_link_found", "scan_coverage"],
      explanation: "На сайте обнаружен сбор персональных данных, но ссылка на политику обработки персональных данных не найдена."
    };
  }
  if (!completeCoverage(index)) {
    return noBuiltin("Crawl coverage is incomplete; absence of personal-data collection cannot be concluded");
  }
  return {
    status: "PASS",
    evidenceFactTypes: ["scan_coverage"],
    summary: "На проверенных страницах не обнаружены формы, собирающие персональные данные.",
    explanation: "На проверенных страницах scanner не обнаружил формы с явными полями персональных данных."
  };
}

function evaluatePd003(index: FactIndex): BuiltinEvaluation {
  const pdCollection = boolFact(index, "personal_data_collection_found");
  if (!pdCollection) {
    return noBuiltin("Personal-data collection page was not detected");
  }
  const blockedPageFacts = index.facts.filter(
    (fact) => fact.factType === "policy_access_from_collection_page" && fact.value.found === false
  );
  const allowedPageFacts = index.facts.filter(
    (fact) => fact.factType === "policy_access_from_collection_page" && fact.value.found === true
  );
  if (blockedPageFacts.length > 0) {
    if (!completeCoverage(index)) {
      return noBuiltin("Crawl coverage is incomplete; missing policy access cannot be concluded");
    }
    return {
      status: "FAIL",
      evidenceFactTypes: ["policy_access_from_collection_page", "personal_data_collection_found"],
      explanation: "На странице, где собираются персональные данные, не найден доступный путь к политике обработки персональных данных."
    };
  }
  if (allowedPageFacts.length > 0) {
    return {
      status: "PASS",
      evidenceFactTypes: ["policy_access_from_collection_page"],
      evidenceIds: collectEvidenceIdsForFactTypesOnPages(
        index,
        ["privacy_policy_link_found"],
        allowedPageFacts.map((fact) => fact.pageUrl).filter((pageUrl): pageUrl is string => Boolean(pageUrl))
      ),
      explanation: "На страницах сбора персональных данных найден путь к политике обработки персональных данных."
    };
  }
  return noBuiltin("Policy access from collection pages was not observed");
}

function evaluatePd006(index: FactIndex): BuiltinEvaluation {
  const pdCollection = boolFact(index, "personal_data_collection_found");
  if (!pdCollection) {
    return noBuiltin("Personal-data collection page was not detected");
  }

  const controls = index.facts.filter(
    (fact) => fact.factType === "rendered_consent_control_found" && fact.value.personalDataConsent === true
  );
  if (controls.length === 0) {
    return noBuiltin("Rendered personal-data consent control was not observed");
  }

  const checkedByControl = checkedFactsByControl(index, "rendered_consent_checked");
  const matched = controls.map((control) => ({ control, checked: checkedByControl.get(controlKey(control)) }));
  if (matched.some((item) => !item.checked)) {
    return noBuiltin("Rendered personal-data consent checked state was not fully observed");
  }

  const checked = matched.find((item) => item.checked?.value.checked === true);
  if (checked) {
    return {
      status: "FAIL",
      evidenceFactTypes: [],
      evidenceIds: collectEvidenceIdsForFacts(index, [
        ...controls,
        ...matched.map((item) => item.checked).filter((fact): fact is Fact => Boolean(fact)),
        ...factsByType(index, "personal_data_collection_found")
      ]),
      explanation: "На форме сбора персональных данных согласие на обработку персональных данных заранее отмечено."
    };
  }

  return {
    status: "PASS",
    evidenceIds: collectEvidenceIdsForFacts(index, [
      ...controls,
      ...matched.map((item) => item.checked).filter((fact): fact is Fact => Boolean(fact))
    ]),
    explanation: "На форме сбора персональных данных согласие на обработку персональных данных не отмечено заранее."
  };
}

function evaluatePd011(index: FactIndex): BuiltinEvaluation {
  const controls = factsByType(index, "rendered_marketing_consent_found");
  if (controls.length === 0) {
    return noBuiltin("Rendered marketing consent control was not observed");
  }

  const checkedByControl = checkedFactsByControl(index, "rendered_marketing_consent_checked");
  const matched = controls.map((control) => ({ control, checked: checkedByControl.get(controlKey(control)) }));
  if (matched.some((item) => !item.checked)) {
    return noBuiltin("Rendered marketing consent checked state was not fully observed");
  }

  const checked = matched.find((item) => item.checked?.value.checked === true);
  if (checked) {
    return {
      status: "FAIL",
      evidenceFactTypes: [],
      evidenceIds: collectEvidenceIdsForFacts(index, [
        ...controls,
        ...matched.map((item) => item.checked).filter((fact): fact is Fact => Boolean(fact))
      ]),
      explanation: "На сайте найдено согласие на рекламные или маркетинговые сообщения, заранее отмеченное для пользователя."
    };
  }

  return {
    status: "PASS",
    evidenceIds: collectEvidenceIdsForFacts(index, [
      ...controls,
      ...matched.map((item) => item.checked).filter((fact): fact is Fact => Boolean(fact))
    ]),
    explanation: "Согласие на рекламные или маркетинговые сообщения найдено и не отмечено заранее."
  };
}

function evaluateEc001(index: FactIndex): BuiltinEvaluation {
  const remoteSale = boolFact(index, "remote_sale_detected");
  const offerFound = boolFact(index, "offer_link_found");
  if (!remoteSale || offerFound === undefined) {
    return noBuiltin("Remote-sale or offer search facts are not sufficient");
  }
  if (offerFound) {
    return {
      status: "PASS",
      evidenceFactTypes: ["offer_link_found"],
      explanation: "Для ECOMMERCE scan обнаружена ссылка на оферту."
    };
  }
  if (!completeCoverage(index)) {
    return noBuiltin("Crawl coverage is incomplete; offer absence cannot be concluded");
  }
  if (!offerFound) {
    return {
      status: "FAIL",
      evidenceFactTypes: ["remote_sale_detected", "offer_link_found", "scan_coverage"],
      explanation: "Для дистанционной продажи не обнаружена ссылка на оферту."
    };
  }
  return noBuiltin("Remote-sale or offer search facts are not sufficient");
}

function evaluateAccessibility(
  index: FactIndex,
  factType: string,
  text: { fail: string; pass: string }
): BuiltinEvaluation {
  const accessible = accessibilityFact(index, factType);
  if (accessible === undefined) {
    return noBuiltin(`${factType} was not observed by the crawler`);
  }
  if (!accessible) {
    return { status: "FAIL", evidenceFactTypes: [factType], explanation: text.fail };
  }
  return { status: "PASS", evidenceFactTypes: [factType], explanation: text.pass };
}

function evaluateSellerMissing(
  index: FactIndex,
  expectedSellerKind: string,
  factType: string,
  text: { fail: string; pass: string }
): BuiltinEvaluation {
  if (sellerKind(index) !== expectedSellerKind) {
    return noBuiltin(`Seller kind is not ${expectedSellerKind}`);
  }
  const found = boolFact(index, factType);
  if (found === undefined) {
    return noBuiltin(`${factType} was not fully checked`);
  }
  if (found) {
    return {
      status: "PASS",
      evidenceFactTypes: ["seller_kind", factType],
      evidenceIds: factType === "legal_name_found" ? collectEvidenceIds(index, ["seller_legal_name_candidate"]) : [],
      explanation: text.pass
    };
  }
  if (!completeCoverage(index)) {
    return noBuiltin(`Crawl coverage is incomplete; ${factType} absence cannot be concluded`);
  }
  if (!found) {
    return { status: "FAIL", evidenceFactTypes: ["seller_kind", factType, "scan_coverage"], explanation: text.fail };
  }
  return noBuiltin(`${factType} was not fully checked`);
}

function evaluateSellerContactMissing(
  index: FactIndex,
  expectedSellerKind: string,
  status: RuleEvaluation["status"],
  text: { fail: string; pass: string }
): BuiltinEvaluation {
  if (sellerKind(index) !== expectedSellerKind) {
    return noBuiltin(`Seller kind is not ${expectedSellerKind}`);
  }
  const email = boolFact(index, "seller_email_found");
  const phone = boolFact(index, "seller_phone_found");
  if (email === undefined || phone === undefined) {
    return noBuiltin("Seller contact facts were not fully checked");
  }
  if (email || phone) {
    return {
      status: "PASS",
      evidenceFactTypes: ["seller_kind", email ? "seller_email_found" : "seller_phone_found"],
      explanation: text.pass
    };
  }
  if (!completeCoverage(index)) {
    return noBuiltin("Crawl coverage is incomplete; seller contact absence cannot be concluded");
  }
  if (!email && !phone) {
    return {
      status,
      evidenceFactTypes: ["seller_kind", "seller_email_found", "seller_phone_found", "scan_coverage"],
      explanation: text.fail
    };
  }
  return noBuiltin("Seller contact facts were not fully checked");
}

function evaluateEc013(index: FactIndex): BuiltinEvaluation {
  const consumerOffer = boolFact(index, "consumer_offer_detected");
  const priceFound = boolFact(index, "price_found");
  const rublePriceFound = boolFact(index, "ruble_price_found");
  if (!consumerOffer || !priceFound || rublePriceFound === undefined) {
    return noBuiltin("Consumer price facts are not sufficient");
  }
  if (rublePriceFound) {
    return { status: "PASS", evidenceFactTypes: ["ruble_price_found"], explanation: "На странице обнаружена цена в рублях." };
  }
  if (!completeCoverage(index)) {
    return noBuiltin("Crawl coverage is incomplete; ruble price absence cannot be concluded");
  }
  if (!rublePriceFound) {
    return {
      status: "FAIL",
      evidenceFactTypes: ["price_occurrence", "ruble_price_found"],
      explanation: "На странице обнаружена цена товара/услуги, но цена в рублях не найдена."
    };
  }
  return noBuiltin("Consumer price facts are not sufficient");
}

function evaluateEc011(index: FactIndex): BuiltinEvaluation {
  const controls = factsByType(index, "paid_addon_control_found");
  if (controls.length === 0) {
    return noBuiltin("Paid add-on control was not observed on a checkout-like page");
  }

  const preselectedByControl = checkedFactsByControl(index, "paid_addon_preselected");
  const matched = controls.map((control) => ({ control, preselected: preselectedByControl.get(controlKey(control)) }));
  if (matched.some((item) => !item.preselected)) {
    return noBuiltin("Paid add-on preselected state was not fully observed");
  }

  const preselected = controls.find((control) => preselectedByControl.get(controlKey(control))?.value.preselected === true);
  if (preselected) {
    return {
      status: "FAIL",
      evidenceFactTypes: [],
      evidenceIds: collectEvidenceIdsForFacts(index, [
        ...controls,
        ...factsByType(index, "paid_addon_preselected")
      ]),
      explanation: "В сценарии покупки обнаружена платная дополнительная услуга или товар, заранее выбранные для пользователя."
    };
  }

  return {
    status: "PASS",
    evidenceIds: collectEvidenceIdsForFacts(index, [
      ...controls,
      ...matched.map((item) => item.preselected).filter((fact): fact is Fact => Boolean(fact))
    ]),
    explanation: "В сценарии покупки найденная платная дополнительная услуга или товар не выбраны заранее."
  };
}

function evaluateCon001(index: FactIndex): BuiltinEvaluation {
  if (sellerKind(index) !== "LEGAL_ENTITY") {
    return noBuiltin("Seller kind is not LEGAL_ENTITY");
  }
  const missing = boolFact(index, "legal_name_or_address_or_working_hours_missing");
  if (missing === undefined) {
    return noBuiltin("Required consumer seller details were not fully checked");
  }
  if (missing) {
    return {
      status: "WARNING",
      evidenceFactTypes: ["seller_kind", "legal_name_or_address_or_working_hours_missing"],
      explanation: "На B2C-сайте с признаками юрлица-продавца не обнаружен полный набор базовых сведений об организации."
    };
  }
  return {
    status: "PASS",
    evidenceFactTypes: ["seller_kind", "legal_name_or_address_or_working_hours_missing"],
    explanation: "На B2C-сайте обнаружены базовые сведения об организации."
  };
}

function evaluateCon002(index: FactIndex): BuiltinEvaluation {
  if (sellerKind(index) !== "INDIVIDUAL_ENTREPRENEUR") {
    return noBuiltin("Seller kind is not INDIVIDUAL_ENTREPRENEUR");
  }
  const registrationInfo = boolFact(index, "ip_registration_info_found");
  if (registrationInfo === undefined) {
    return noBuiltin("IP registration information was not fully checked");
  }
  if (!registrationInfo) {
    return {
      status: "WARNING",
      evidenceFactTypes: ["seller_kind", "ip_registration_info_found"],
      explanation: "На B2C-сайте ИП не обнаружена информация о государственной регистрации."
    };
  }
  return {
    status: "PASS",
    evidenceFactTypes: ["seller_kind", "ip_registration_info_found"],
    explanation: "На B2C-сайте ИП обнаружены сведения о государственной регистрации."
  };
}

function buildFactIndex(facts: Fact[], evidence: Evidence[]): FactIndex {
  const evidenceByFactId = new Map<string, Evidence[]>();
  for (const item of evidence) {
    if (!item.factId) {
      continue;
    }
    const existing = evidenceByFactId.get(item.factId) ?? [];
    existing.push(item);
    evidenceByFactId.set(item.factId, existing);
  }
  return { facts, evidenceByFactId };
}

function collectEvidenceIds(index: FactIndex, factTypes: string[]): string[] {
  const ids = new Set<string>();
  for (const fact of index.facts) {
    if (!factTypes.includes(fact.factType)) {
      continue;
    }
    for (const evidence of index.evidenceByFactId.get(fact.id) ?? []) {
      ids.add(evidence.id);
    }
  }
  return [...ids];
}

function collectEvidenceIdsForFactTypesOnPages(index: FactIndex, factTypes: string[], pageUrls: string[]): string[] {
  const pages = new Set(pageUrls);
  const ids = new Set<string>();
  for (const fact of index.facts) {
    if (!fact.pageUrl || !pages.has(fact.pageUrl) || !factTypes.includes(fact.factType)) {
      continue;
    }
    for (const evidence of index.evidenceByFactId.get(fact.id) ?? []) {
      ids.add(evidence.id);
    }
  }
  return [...ids];
}

function collectEvidenceIdsForFacts(index: FactIndex, facts: Fact[]): string[] {
  const ids = new Set<string>();
  for (const fact of facts) {
    for (const evidence of index.evidenceByFactId.get(fact.id) ?? []) {
      ids.add(evidence.id);
    }
  }
  return [...ids];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function boolFact(index: FactIndex, factType: string): boolean | undefined {
  const facts = index.facts.filter((fact) => fact.factType === factType);
  if (facts.some((fact) => fact.value.found === true || fact.value.detected === true)) {
    return true;
  }
  if (facts.some((fact) => fact.value.found === false || fact.value.detected === false)) {
    return false;
  }
  return undefined;
}

function accessibilityFact(index: FactIndex, factType: string): boolean | undefined {
  const facts = index.facts.filter((fact) => fact.factType === factType);
  if (facts.some((fact) => fact.value.accessible === false)) {
    return false;
  }
  if (facts.some((fact) => fact.value.accessible === true)) {
    return true;
  }
  return undefined;
}

function completeCoverage(index: FactIndex): boolean {
  return index.facts.some(
    (fact) =>
      fact.factType === "scan_coverage" &&
      fact.value.crawlCompleted === true &&
      fact.value.contentLimited !== true &&
      fact.value.maxPagesReached !== true &&
      Number(fact.value.successfulHtmlPages ?? 1) > 0 &&
      Number(fact.value.httpErrorPages ?? 0) === 0
  );
}

function sellerKind(index: FactIndex): string | undefined {
  return index.facts.find((fact) => fact.factType === "seller_kind")?.value.kind as string | undefined;
}

function factsByType(index: FactIndex, factType: string): Fact[] {
  return index.facts.filter((fact) => fact.factType === factType);
}

function checkedFactsByControl(index: FactIndex, factType: string): Map<string, Fact> {
  const result = new Map<string, Fact>();
  for (const fact of factsByType(index, factType)) {
    result.set(controlKey(fact), fact);
  }
  return result;
}

function controlKey(fact: Fact): string {
  return [
    fact.pageUrl ?? "",
    String(fact.value.formIndex ?? ""),
    String(fact.value.controlIndex ?? "")
  ].join("::");
}

function sellerApplicabilityBlockReason(ruleId: string, index: FactIndex): string | undefined {
  const kind = sellerKind(index);
  if (!kind) {
    return undefined;
  }

  if (["EC-003", "EC-004", "EC-005", "EC-006", "CON-001"].includes(ruleId) && kind !== "LEGAL_ENTITY") {
    return `Rule does not apply to seller_kind=${kind}`;
  }

  if (["EC-007", "EC-008", "EC-009", "CON-002"].includes(ruleId) && kind !== "INDIVIDUAL_ENTREPRENEUR") {
    return `Rule does not apply to seller_kind=${kind}`;
  }

  return undefined;
}

function hasFact(index: FactIndex, factType: string): boolean {
  return index.facts.some((fact) => fact.factType === factType);
}

function noEvaluation(rule: Rule, reason: string): RuleEvaluationResult {
  return { ruleId: rule.ruleId, ruleVersion: rule.version, status: "NO_EVALUATION", reason };
}

function noBuiltin(reason: string): BuiltinEvaluation {
  return { status: "NO_EVALUATION", reason };
}

function confidence(rule: Rule): number {
  const value = rule.confidencePolicy.fixed_confidence;
  return typeof value === "number" ? value : 0.8;
}

function summaryFor(rule: Rule, status: RuleEvaluation["status"]): string {
  return status === "PASS" ? rule.passSummary : rule.title;
}
