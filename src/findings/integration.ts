import type { Queryable } from "@/db/client";
import {
  deleteFindingForRule,
  getEvidenceForScan,
  getFactsForScan,
  getOwnerAnswersForScan,
  upsertFinding
} from "@/db/repository";
import type { OwnerAnswer, OwnerRuleEvaluation, SiteFactRef } from "@/owner-context/types";
import { evaluateOwnerRules } from "@/owner-context/engine";
import { loadPilotSemanticRuntimeRules, loadRuntimeRules } from "@/legal-rules/runtime";
import { assertEvidencePolicy } from "@/findings/builder";
import { evaluateRulesForScan } from "@/rule-engine/evaluator";
import type { Rule, RuleEvaluation, RuleEvaluationResult } from "@/rule-engine/types";
import type { Scan } from "@/db/schema";
import type { Evidence } from "@/evidence/types";
import type { Fact } from "@/facts/types";
import { evaluateSemanticRulesShadow, type SemanticShadowEvaluation } from "@/semantic-evaluator/shadow";
import { GigaChatSemanticModelProvider } from "@/semantic-evaluator/providers/gigachat";
import type { SemanticModelProvider } from "@/semantic-evaluator/types";

export interface PersistProductionFindingsInput {
  scan: Scan;
  facts: Fact[];
  evidence: Evidence[];
  ownerAnswers?: OwnerAnswer[];
  semanticProvider?: SemanticModelProvider;
}

export async function persistProductionFindings(
  db: Queryable,
  input: PersistProductionFindingsInput
): Promise<RuleEvaluation[]> {
  const persisted: RuleEvaluation[] = [];

  for (const evaluation of evaluateRulesForScan({
    scan: input.scan,
    facts: input.facts,
    evidence: input.evidence,
    rules: loadRuntimeRules()
  })) {
    if (evaluation.status === "NO_EVALUATION") {
      continue;
    }
    assertEvidencePolicy(evaluation);
    await upsertFinding(db, { ...evaluation, scanId: input.scan.id });
    persisted.push(evaluation);
  }

  const semanticProvider = input.semanticProvider ?? configuredSemanticProvider();
  if (semanticProvider) {
    const semanticEvaluations = await evaluateSemanticRulesShadow({
      scan: input.scan,
      facts: input.facts,
      evidence: input.evidence,
      provider: semanticProvider
    });
    for (const evaluation of semanticEvaluations.flatMap((item) => semanticFindingFor(item))) {
      assertEvidencePolicy(evaluation);
      await upsertFinding(db, { ...evaluation, scanId: input.scan.id });
      persisted.push(evaluation);
    }
  }

  const ownerAnswers = input.ownerAnswers ?? [];
  for (const evaluation of ownerFindingsFor({
    ownerEvaluations: evaluateOwnerRules({
      siteType: input.scan.siteType,
      facts: input.facts,
      answers: ownerAnswers
    }),
    evidence: input.evidence
  })) {
    await upsertFinding(db, { ...evaluation, scanId: input.scan.id });
    persisted.push(evaluation);
  }

  return persisted;
}

export async function persistOwnerFindingsForScan(db: Queryable, scan: Scan): Promise<RuleEvaluation[]> {
  const facts = await getFactsForScan(db, scan.id);
  const evidence = await getEvidenceForScan(db, scan.id);
  const ownerAnswers = await getOwnerAnswersForScan(db, scan.id);
  const ownerEvaluations = evaluateOwnerRules({ siteType: scan.siteType, facts, answers: ownerAnswers });
  const evaluations = ownerFindingsFor({ ownerEvaluations, evidence });
  const persistedKeys = new Set(evaluations.map((evaluation) => evaluation.ruleId));

  for (const evaluation of evaluations) {
    await upsertFinding(db, { ...evaluation, scanId: scan.id });
  }

  for (const evaluation of ownerEvaluations) {
    const metadata = OWNER_FINDING_METADATA[evaluation.ruleId];
    if (!metadata || persistedKeys.has(evaluation.ruleId)) {
      continue;
    }
    await deleteFindingForRule(db, {
      scanId: scan.id,
      ruleId: evaluation.ruleId,
      ruleVersion: metadata.ruleVersion
    });
  }

  return evaluations;
}

function semanticFindingFor(evaluation: SemanticShadowEvaluation): RuleEvaluation[] {
  if (evaluation.status === "NO_EVALUATION") {
    return [];
  }

  const rule = loadPilotSemanticRuntimeRules().find((item) => item.ruleId === evaluation.ruleId);
  if (!rule) {
    return [];
  }

  const text = SEMANTIC_TEXT[evaluation.ruleId] ?? defaultSemanticText(rule);
  return [
    {
      ruleId: evaluation.ruleId,
      ruleVersion: rule.version,
      status: evaluation.status,
      severity: rule.severity,
      confidence: "confidence" in evaluation.result ? evaluation.result.confidence : 0.8,
      summary: text.summary[evaluation.status],
      explanation: text.explanation[evaluation.status],
      remediation: text.remediation[evaluation.status],
      evidenceIds: evidenceIdsFromSemanticRefs(evaluation.evidenceRefs),
      missingContext: evaluation.status === "MANUAL_CHECK" ? [text.manualContext] : []
    }
  ];
}

function ownerFindingsFor(input: {
  ownerEvaluations: OwnerRuleEvaluation[];
  evidence: Evidence[];
}): RuleEvaluation[] {
  return input.ownerEvaluations.flatMap((evaluation) => ownerFindingFor(evaluation, input.evidence));
}

function ownerFindingFor(evaluation: OwnerRuleEvaluation, evidence: Evidence[]): RuleEvaluation[] {
  if (evaluation.status === "NOT_APPLICABLE") {
    return [];
  }
  if (evaluation.status === "UNRESOLVED" && evaluation.reasonCode !== "ANSWER_REQUIRED") {
    return [];
  }

  const metadata = OWNER_FINDING_METADATA[evaluation.ruleId];
  if (!metadata) {
    return [];
  }

  const status = evaluation.status === "UNRESOLVED" ? "MANUAL_CHECK" : evaluation.status;
  const text = ownerTextFor(evaluation, metadata);

  return [
    {
      ruleId: evaluation.ruleId,
      ruleVersion: metadata.ruleVersion,
      status,
      severity: metadata.severity,
      confidence: status === "MANUAL_CHECK" ? 0.55 : 0.8,
      summary: text.summary,
      explanation: text.explanation,
      remediation: text.remediation,
      evidenceIds: evidenceIdsForSiteFactRefs(evaluation.siteFactRefs, evidence),
      missingContext: text.missingContext ? [text.missingContext] : []
    }
  ];
}

function ownerTextFor(evaluation: OwnerRuleEvaluation, metadata: OwnerFindingMetadata): OwnerFindingText {
  if (evaluation.reasonCode === "OWNER_ANSWER_CONFLICTS_WITH_SITE_EVIDENCE") {
    return {
      summary: metadata.summary.manual,
      explanation: "Ваш ответ не совпадает с тем, что обнаружено на сайте. Проверьте этот пункт вручную.",
      remediation: metadata.remediation.manual,
      missingContext: metadata.manualContext
    };
  }

  if (evaluation.reasonCode === "ANSWER_REQUIRED") {
    return {
      summary: metadata.summary.manual,
      explanation: metadata.explanation.MANUAL_CHECK ?? metadata.manualContext,
      remediation: metadata.remediation.manual,
      missingContext: metadata.manualContext
    };
  }

  if (evaluation.status === "PASS") {
    return {
      summary: metadata.summary.pass,
      explanation: metadata.explanation.PASS ?? evaluation.explanation,
      remediation: "Дополнительные действия не требуются.",
      missingContext: undefined
    };
  }

  if (evaluation.status === "FAIL") {
    return {
      summary: metadata.summary.fail,
      explanation: metadata.explanation.FAIL ?? evaluation.explanation,
      remediation: metadata.remediation.fail,
      missingContext: undefined
    };
  }

  if (evaluation.status === "WARNING") {
    return {
      summary: metadata.summary.warning ?? metadata.summary.manual,
      explanation: metadata.explanation.WARNING ?? evaluation.explanation,
      remediation: metadata.remediation.warning ?? metadata.remediation.manual,
      missingContext: undefined
    };
  }

  return {
    summary: metadata.summary.manual,
    explanation: metadata.explanation.MANUAL_CHECK ?? metadata.manualContext,
    remediation: metadata.remediation.manual,
    missingContext: metadata.manualContext
  };
}

function evidenceIdsForSiteFactRefs(refs: SiteFactRef[], evidence: Evidence[]): string[] {
  const factIds = new Set(refs.map((ref) => ref.factId));
  return unique(evidence.filter((item) => item.factId && factIds.has(item.factId)).map((item) => item.id));
}

function evidenceIdsFromSemanticRefs(refs: string[]): string[] {
  return unique(refs.map((ref) => ref.split(":")[1]).filter((id): id is string => Boolean(id)));
}

function configuredSemanticProvider(): SemanticModelProvider | undefined {
  if (!process.env.GIGACHAT_AUTH_KEY || !process.env.GIGACHAT_MODEL) {
    return undefined;
  }

  try {
    return new GigaChatSemanticModelProvider();
  } catch {
    return undefined;
  }
}

function defaultSemanticText(rule: Rule): SemanticFindingText {
  return {
    summary: {
      PASS: rule.passSummary,
      FAIL: rule.title,
      MANUAL_CHECK: rule.title
    },
    explanation: {
      PASS: "В проверенном тексте найден требуемый раздел.",
      FAIL: "В проверенном тексте не найден требуемый раздел.",
      MANUAL_CHECK: "По проверенному тексту нельзя сделать надёжный вывод."
    },
    remediation: {
      PASS: "Дополнительные действия не требуются.",
      FAIL: "Уточните текст документа и добавьте недостающие сведения.",
      MANUAL_CHECK: "Проверьте документ вручную."
    },
    manualContext: "По тексту документа нельзя сделать надёжный вывод."
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

type OwnerFindingMetadata = {
  ruleVersion: string;
  severity: RuleEvaluation["severity"];
  legalBasis: string[];
  summary: {
    pass: string;
    fail: string;
    warning?: string;
    manual: string;
  };
  explanation: Partial<Record<RuleEvaluation["status"], string>>;
  remediation: {
    fail: string;
    warning?: string;
    manual: string;
  };
  manualContext: string;
};

type OwnerFindingText = {
  summary: string;
  explanation: string;
  remediation: string;
  missingContext?: string;
};

type SemanticProductionStatus = "PASS" | "FAIL" | "MANUAL_CHECK";

type SemanticFindingText = {
  summary: Record<SemanticProductionStatus, string>;
  explanation: Record<SemanticProductionStatus, string>;
  remediation: Record<SemanticProductionStatus, string>;
  manualContext: string;
};

export const OWNER_FINDING_METADATA: Record<string, OwnerFindingMetadata> = {
  "PD-007": {
    ruleVersion: "0.3-owner",
    severity: "HIGH",
    legalBasis: ["152-ФЗ, ст. 6"],
    summary: {
      pass: "Указано основание обработки данных из найденных форм.",
      fail: "Для данных из найденных форм не указано законное основание обработки.",
      manual: "Основание обработки данных требует дополнительной проверки."
    },
    explanation: {
      PASS: "Владелец сайта указал законное основание обработки данных из найденных форм.",
      FAIL: "Владелец сайта указал, что законного основания для обработки данных нет."
    },
    remediation: {
      fail: "Определите законное основание обработки данных или прекратите сбор данных через форму.",
      manual: "Проверьте основание обработки данных по каждой найденной форме."
    },
    manualContext: "Уточните законное основание обработки данных для каждой найденной формы."
  },
  "PD-012": {
    ruleVersion: "0.3-owner",
    severity: "HIGH",
    legalBasis: ["152-ФЗ, ст. 15"],
    summary: {
      pass: "Согласие на рекламные сообщения подтверждается.",
      fail: "Согласие на рекламные сообщения не подтверждается.",
      manual: "Согласие на рекламные сообщения требует дополнительной проверки."
    },
    explanation: {
      PASS: "Владелец сайта указал, что подтверждение согласия на рекламные сообщения сохраняется.",
      FAIL: "Владелец сайта указал, что отдельное согласие на рекламные сообщения не получается."
    },
    remediation: {
      fail: "Получайте предварительное согласие на рекламные сообщения и сохраняйте подтверждение его получения.",
      manual: "Проверьте, есть ли согласие на рекламные сообщения и можно ли подтвердить его получение."
    },
    manualContext: "Уточните, отправляются ли рекламные сообщения и сохраняется ли подтверждение согласия."
  },
  "PD-022": ownerMetadata(
    "152-ФЗ, ст. 18 ч. 5",
    "Локализация базы персональных данных требует дополнительной проверки.",
    "Уточните, где происходит первичная запись персональных данных пользователей: в России или за её пределами.",
    "Уточните место первичной записи персональных данных пользователей."
  ),
  "PD-023": ownerMetadata(
    "152-ФЗ, ст. 22",
    "Уведомление об обработке персональных данных требует дополнительной проверки.",
    "Проверьте оператора в официальном реестре Роскомнадзора по ИНН, ОГРН или названию и уточните, подано ли уведомление или применимо ли законное исключение.",
    "Уточните, есть ли запись оператора в официальном реестре Роскомнадзора или применимо ли законное исключение."
  ),
  "ADV-001": ownerMetadata(
    "38-ФЗ, ст. 18.1",
    "Квалификация рекламного материала требует дополнительной проверки.",
    "Уточните, является ли найденный блок рекламой в интернете.",
    "Уточните, является ли найденный блок рекламой в интернете."
  ),
  "ADV-002": ownerMetadata(
    "38-ФЗ, ст. 18.1",
    "Сведения о рекламодателе требуют дополнительной проверки.",
    "Уточните, есть ли для найденной рекламы сведения о рекламодателе.",
    "Уточните наличие сведений о рекламодателе для найденного рекламного материала."
  ),
  "ADV-003": ownerMetadata(
    "38-ФЗ, ст. 18.1",
    "Идентификатор рекламы требует дополнительной проверки.",
    "Уточните, присвоен ли найденной рекламе идентификатор.",
    "Уточните наличие идентификатора у найденного рекламного материала."
  ),
  "ADV-004": {
    ruleVersion: "0.3-owner",
    severity: "HIGH",
    legalBasis: ["38-ФЗ, ст. 18"],
    summary: {
      pass: "Согласие на рекламную рассылку подтверждается.",
      fail: "Согласие на рекламную рассылку не подтверждается.",
      manual: "Рекламная рассылка требует дополнительной проверки."
    },
    explanation: {
      PASS: "Владелец сайта указал, что подтверждение согласия на рекламную рассылку сохраняется.",
      FAIL: "Владелец сайта указал, что отдельное согласие на рекламную рассылку не получается."
    },
    remediation: {
      fail: "Получайте предварительное согласие на рекламную рассылку и сохраняйте подтверждение его получения.",
      manual: "Проверьте, есть ли согласие на рекламную рассылку и можно ли подтвердить его получение."
    },
    manualContext: "Уточните, отправляется ли рекламная рассылка и сохраняется ли подтверждение согласия."
  },
  "AUTH-001": ownerMetadata(
    "149-ФЗ, ст. 10.2",
    "Способы входа на сайт требуют дополнительной проверки.",
    "Уточните, кто владеет сайтом и какие способы входа доступны пользователям из России.",
    "Уточните владельца сайта и доступные способы входа."
  ),
  "REC-001": ownerMetadata(
    "149-ФЗ, ст. 10.2-2",
    "Использование рекомендательных технологий требует дополнительной проверки.",
    "Уточните, подбирает ли сайт товары, услуги или материалы под конкретного пользователя.",
    "Уточните, используются ли на сайте рекомендательные технологии."
  ),
  "REC-002": ownerMetadata(
    "149-ФЗ, ст. 10.2-2",
    "Правила рекомендательных технологий требуют дополнительной проверки.",
    "Уточните, опубликованы ли правила работы рекомендательных технологий.",
    "Уточните наличие правил работы рекомендательных технологий."
  ),
  "REC-004": ownerMetadata(
    "149-ФЗ, ст. 10.2-2",
    "Контакт для вопросов о рекомендациях требует дополнительной проверки.",
    "Уточните, указан ли способ связи по вопросам рекомендательных технологий.",
    "Уточните контакт для вопросов о рекомендательных технологиях."
  ),
  "LANG-002": ownerMetadata(
    "Закон о защите прав потребителей, ст. 8",
    "Иностранный язык в потребительской информации требует дополнительной проверки.",
    "Уточните, почему найденная потребительская информация оставлена без русского перевода.",
    "Уточните основание для размещения потребительской информации без русского перевода."
  ),
  "EC-017": ownerMetadata(
    "Постановление Правительства РФ №657, п. 17",
    "Подтверждение заказа с идентификатором требует дополнительной проверки.",
    "Проверьте, получает ли покупатель после оформления заказа подтверждение с номером заказа или другим идентификатором.",
    "Уточните, содержит ли подтверждение заказа номер заказа или другой идентификатор."
  )
};

export const SEMANTIC_LEGAL_BASIS: Record<string, string[]> = {
  "PD-005": ["152-ФЗ, ст. 9"],
  "PD-008": ["152-ФЗ, ст. 9"],
  "PD-009": ["152-ФЗ, ст. 9"],
  "PD-010": ["152-ФЗ, ст. 9", "152-ФЗ, ст. 15"],
  "PD-013": ["152-ФЗ, ст. 18.1 ч. 1 п. 2, ч. 2"],
  "PD-014": ["152-ФЗ, ст. 18.1 ч. 1 п. 2, ч. 2"],
  "PD-015": ["152-ФЗ, ст. 18.1 ч. 1 п. 2, ч. 2"],
  "PD-016": ["152-ФЗ, ст. 18.1 ч. 1 п. 2, ч. 2"],
  "PD-017": ["152-ФЗ, ст. 18.1 ч. 1 п. 2, ч. 2"],
  "PD-018": ["152-ФЗ, ст. 18.1 ч. 1 п. 2, ч. 2"],
  "PD-019": ["152-ФЗ, ст. 18.1 ч. 1 п. 2, ч. 2"],
  "PD-024": ["152-ФЗ, ст. 10"],
  "CK-001": ["152-ФЗ, ст. 18.1 ч. 1 п. 2, ч. 2"],
  "CK-004": ["152-ФЗ, ст. 9"],
  "EC-010": ["Постановление Правительства РФ №657, п. 24"],
  "EC-012": ["Закон о защите прав потребителей, ст. 16 п. 3.1"],
  "EC-014": ["Закон о защите прав потребителей, ст. 26.1 п. 2", "Постановление Правительства РФ №657, п. 21"],
  "EC-015": ["Закон о защите прав потребителей, ст. 26.1 п. 2", "Постановление Правительства РФ №657, п. 21"],
  "EC-016": ["Закон о защите прав потребителей, ст. 26.1 п. 3–4", "Постановление Правительства РФ №657, п. 25–27"],
  "REC-003": ["149-ФЗ, ст. 10.2-2 ч. 3"],
  "LANG-001": ["Закон о защите прав потребителей, ст. 8–10"]
};

export const SEMANTIC_TEXT: Record<string, SemanticFindingText> = {
  "PD-005": semanticText(
    "Согласие на обработку персональных данных отделено от других условий.",
    "Согласие на обработку персональных данных объединено с другими условиями.",
    "Отдельность согласия на обработку персональных данных требует дополнительной проверки.",
    "Разместите согласие на обработку персональных данных отдельно от принятия оферты, пользовательского соглашения и других самостоятельных условий."
  ),
  "PD-008": semanticText(
    "В тексте согласия указана цель обработки персональных данных.",
    "В тексте согласия не найдена понятная цель обработки персональных данных.",
    "Цель обработки в тексте согласия требует дополнительной проверки.",
    "Добавьте в текст согласия конкретную цель обработки персональных данных."
  ),
  "PD-009": semanticText(
    "В тексте согласия указан конкретный объём обработки персональных данных.",
    "В тексте согласия найден слишком широкий или неограниченный объём обработки.",
    "Объём обработки в тексте согласия требует дополнительной проверки.",
    "Уточните в согласии конкретный состав данных, действия с ними или ограниченный контекст обработки."
  ),
  "PD-010": semanticText(
    "Согласие на рекламные сообщения отделено от обязательных условий.",
    "Согласие на рекламные сообщения объединено с обязательными условиями.",
    "Отдельность согласия на рекламные сообщения требует дополнительной проверки.",
    "Разместите согласие на рекламные сообщения отдельно от обязательного согласия на обработку данных, договора, оферты или пользовательского соглашения."
  ),
  "CK-001": semanticText(
    "В политике раскрыты cookie, идентификаторы или технологии отслеживания.",
    "В политике не найдено раскрытие cookie, идентификаторов или технологий отслеживания.",
    "Раскрытие cookie, идентификаторов или технологий отслеживания требует дополнительной проверки.",
    "Уточните в политике, какие cookie, идентификаторы, аналитические, рекламные или маркетинговые технологии используются и для каких целей."
  ),
  "CK-004": semanticText(
    "Согласие на cookie, аналитику или маркетинговые технологии отделено от обязательных условий.",
    "Согласие на cookie, аналитику или маркетинговые технологии объединено с обязательными условиями.",
    "Отдельность согласия на cookie, аналитику или маркетинговые технологии требует дополнительной проверки.",
    "Разместите необязательное согласие на cookie, аналитику или маркетинговые технологии отдельно от оферты, договора, пользовательского соглашения и обязательного согласия на обработку данных."
  ),
  "PD-013": semanticText(
    "В политике указаны цели обработки персональных данных.",
    "В политике не найдены понятные цели обработки персональных данных.",
    "Цели обработки в политике требуют дополнительной проверки.",
    "Добавьте в политику конкретные цели обработки персональных данных."
  ),
  "PD-014": semanticText(
    "В политике указаны категории персональных данных.",
    "В политике не найдены категории персональных данных.",
    "Категории данных в политике требуют дополнительной проверки.",
    "Добавьте в политику категории или примеры персональных данных, которые обрабатываются."
  ),
  "PD-015": semanticText(
    "В политике описаны сроки хранения или порядок удаления данных.",
    "В политике не найдено описание сроков хранения или порядка удаления данных.",
    "Сроки хранения или порядок удаления данных требуют дополнительной проверки.",
    "Добавьте в политику сроки хранения, условия прекращения обработки или порядок удаления данных."
  ),
  "PD-016": semanticText(
    "В политике описан порядок обращений по персональным данным.",
    "В политике не найден порядок обращений по персональным данным.",
    "Порядок обращений по персональным данным требует дополнительной проверки.",
    "Добавьте в политику понятный способ подать запрос по своим персональным данным."
  ),
  "PD-017": semanticText(
    "Категории данных из найденных форм отражены в политике.",
    "В политике отражены не все категории данных из найденных форм.",
    "Соответствие форм и политики по категориям данных требует дополнительной проверки.",
    "Добавьте в политику категории персональных данных, которые фактически собираются через формы сайта."
  ),
  "PD-018": semanticText(
    "Внешние сервисы, связанные с обработкой данных, отражены в политике.",
    "В политике не отражены найденные внешние сервисы, связанные с обработкой данных.",
    "Раскрытие внешних сервисов в политике требует дополнительной проверки.",
    "Уточните в политике получателей, обработчиков или категории внешних сервисов, связанных с обработкой персональных данных."
  ),
  "PD-019": semanticText(
    "Утверждение политики об отсутствии передачи третьим лицам согласуется с найденными сервисами.",
    "Утверждение политики об отсутствии передачи третьим лицам противоречит найденным сервисам.",
    "Утверждение политики об отсутствии передачи третьим лицам требует дополнительной проверки.",
    "Проверьте утверждение об отсутствии передачи третьим лицам и уточните политику с учётом фактически используемых сервисов."
  ),
  "PD-024": semanticText(
    "В найденных формах не видно признаков сбора специальных категорий персональных данных.",
    "В найденных формах могут запрашиваться специальные категории персональных данных.",
    "В найденных формах могут запрашиваться специальные категории персональных данных.",
    "Проверьте основание и условия обработки таких данных вручную."
  ),
  "EC-010": semanticText(
    "На потребительской странице описан порядок обращений, жалоб или претензий.",
    "На потребительской странице не найден понятный порядок обращений, жалоб или претензий.",
    "Порядок обращений, жалоб или претензий требует дополнительной проверки.",
    "Добавьте понятный способ подать обращение, жалобу или претензию."
  ),
  "EC-012": semanticText(
    "Платная дополнительная услуга выглядит необязательной для основной покупки.",
    "Платная дополнительная услуга выглядит обязательной для основной покупки.",
    "Обязательность платной дополнительной услуги требует дополнительной проверки.",
    "Сделайте платную дополнительную услугу необязательной и дайте пользователю возможность отказаться от неё."
  ),
  "EC-014": semanticText(
    "На странице товара есть содержательная информация для выбора товара.",
    "На странице товара не удалось найти информацию, достаточную для осознанного выбора товара.",
    "Информация о товаре требует дополнительной проверки.",
    "Добавьте на страницу товара понятное описание, основные свойства, состав комплекта или иные сведения, которые помогают потребителю выбрать товар."
  ),
  "EC-015": semanticText(
    "В опубликованных материалах раскрыты применимые условия покупки, оплаты или доставки.",
    "В опубликованных материалах не найдены применимые условия покупки, оплаты или доставки.",
    "Условия покупки, оплаты или доставки требуют дополнительной проверки.",
    "Уточните на странице товара, в оферте, корзине или другом преддоговорном материале применимые условия покупки, оплаты и доставки, если доставка предлагается."
  ),
  "EC-016": semanticText(
    "В опубликованных условиях возврата не найдено явного противоречия правилам дистанционной продажи.",
    "В опубликованных условиях возврата обнаружено положение, которое может противоречить правилам дистанционной продажи.",
    "Условия возврата требуют дополнительной проверки.",
    "Проверьте условия возврата и оплаты расходов при возврате с учётом правил дистанционной продажи."
  ),
  "REC-003": semanticText(
    "Правила рекомендательных технологий доступны на русском языке.",
    "Правила рекомендательных технологий не выглядят доступными на русском языке.",
    "Доступность правил рекомендательных технологий требует дополнительной проверки.",
    "Опубликуйте правила рекомендательных технологий в свободном доступе на русском языке."
  ),
  "LANG-001": semanticText(
    "Обязательная потребительская информация доступна на русском языке или не выглядит иностранной без перевода.",
    "Обязательная потребительская информация выглядит размещённой только на иностранном языке.",
    "Язык потребительской информации требует дополнительной проверки.",
    "Разместите обязательную потребительскую информацию на русском языке или добавьте русский перевод."
  )
};

function ownerMetadata(
  legalBasis: string,
  manualSummary: string,
  manualRemediation = "Проверьте этот пункт вручную.",
  manualContext = manualRemediation
): OwnerFindingMetadata {
  return {
    ruleVersion: "0.3-owner",
    severity: "MEDIUM",
    legalBasis: [legalBasis],
    summary: {
      pass: manualSummary.replace("требует дополнительной проверки", "проверен"),
      fail: manualSummary.replace("требует дополнительной проверки", "требует исправления"),
      manual: manualSummary
    },
    explanation: {
      MANUAL_CHECK: manualRemediation
    },
    remediation: {
      fail: manualRemediation,
      warning: manualRemediation,
      manual: manualRemediation
    },
    manualContext
  };
}

function semanticText(pass: string, fail: string, manual: string, remediation: string): SemanticFindingText {
  return {
    summary: {
      PASS: pass,
      FAIL: fail,
      MANUAL_CHECK: manual
    },
    explanation: {
      PASS: "В проверенном тексте найдено требуемое содержание.",
      FAIL: "В проверенном тексте не найдено требуемое содержание.",
      MANUAL_CHECK: "По проверенному тексту нельзя сделать надёжный вывод."
    },
    remediation: {
      PASS: "Дополнительные действия не требуются.",
      FAIL: remediation,
      MANUAL_CHECK: "Проверьте этот пункт вручную."
    },
    manualContext: "По тексту документа нельзя сделать надёжный вывод."
  };
}
