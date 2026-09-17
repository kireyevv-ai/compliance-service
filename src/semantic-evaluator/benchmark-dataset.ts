import { loadPilotSemanticRuntimeRules } from "@/legal-rules/runtime";
import type { SemanticEvaluationInput, SemanticEvaluationStatus, SemanticEvidenceCompleteness, SemanticObservation } from "./types";

export type PilotBenchmarkRuleId = "PD-005" | "PD-008" | "PD-009" | "PD-010" | "PD-013" | "PD-014" | "PD-015" | "PD-016";
export type BenchmarkExpectedVerdict = SemanticEvaluationStatus;
export type BenchmarkExpectedObservation = SemanticObservation;

export interface BenchmarkEvidence {
  factType: "consent_text" | "privacy_policy_text" | "marketing_consent_control_found" | "rendered_marketing_consent_found";
  excerpt: string;
  completeness: SemanticEvidenceCompleteness;
  truncated?: boolean;
}

export interface PilotBenchmarkCase {
  caseId: string;
  ruleId: PilotBenchmarkRuleId;
  evidence: BenchmarkEvidence[];
  expected: BenchmarkExpectedVerdict;
  expectedObservation: BenchmarkExpectedObservation;
  manualRationale: string;
}

const ruleCriteria = new Map(
  loadPilotSemanticRuntimeRules().map((rule) => {
    if (rule.evaluation.kind !== "SEMANTIC_CRITERION") {
      throw new Error(`Pilot benchmark rule ${rule.ruleId} is not semantic`);
    }
    return [rule.ruleId, { version: rule.version, criterion: rule.evaluation.criterion }];
  })
);

export const PILOT_BENCHMARK_CASES: PilotBenchmarkCase[] = [
  c("PD-005-P01", "PD-005", "PASS", "PRESENT", "Personal-data consent is a separate checkbox.", consent("Отдельный флажок: я согласен на обработку персональных данных для обработки заявки.")),
  c("PD-005-P02", "PD-005", "PASS", "PRESENT", "Offer and personal-data consent are separate controls.", consent("Флажок 1: принимаю оферту. Флажок 2: согласен на обработку персональных данных.")),
  c("PD-005-P03", "PD-005", "PASS", "PRESENT", "Nearby offer link does not merge consent.", consent("Я согласен на обработку персональных данных для обратной связи. Оферта размещена по отдельной ссылке.")),
  c("PD-005-F01", "PD-005", "FAIL", "ABSENT", "One checkbox combines offer and PD consent.", consent("Один флажок: принимаю оферту и даю согласие на обработку персональных данных.", "COMPLETE")),
  c("PD-005-F02", "PD-005", "FAIL", "ABSENT", "One sentence combines user agreement and PD consent.", consent("Нажимая кнопку, пользователь принимает пользовательское соглашение и соглашается на обработку персональных данных.", "COMPLETE")),
  c("PD-005-F03", "PD-005", "FAIL", "ABSENT", "One mandatory agreement combines all independent terms.", consent("Согласен с условиями сервиса, договором и обработкой персональных данных.", "COMPLETE")),
  c("PD-005-M01", "PD-005", "MANUAL_CHECK", "ABSENT", "Partial fragment cannot prove combined consent.", consent("Согласен с условиями.", "PARTIAL")),
  c("PD-005-M02", "PD-005", "MANUAL_CHECK", "AMBIGUOUS", "Wording is too unclear to decide separation.", consent("Нажимая кнопку, подтверждаю согласие с документами сайта.")),

  c("PD-008-P01", "PD-008", "PASS", "PRESENT", "Consent states a concrete callback purpose.", consent("Согласие дается на обработку персональных данных для обратной связи по заявке и подготовки ответа.")),
  c("PD-008-P02", "PD-008", "PASS", "PRESENT", "Consent states order processing purpose.", consent("Нажимая кнопку, пользователь соглашается на обработку данных для оформления заказа и доставки выбранного товара.")),
  c("PD-008-P03", "PD-008", "PASS", "PRESENT", "Consent states account support purpose.", consent("Я согласен на обработку данных для регистрации личного кабинета и оказания технической поддержки.")),
  c("PD-008-F01", "PD-008", "FAIL", "ABSENT", "Consent request has no concrete purpose.", consent("Я даю согласие на обработку моих персональных данных.", "COMPLETE")),
  c("PD-008-F02", "PD-008", "FAIL", "ABSENT", "Consent references processing generally without purpose.", consent("Пользователь подтверждает согласие на любые действия с персональными данными в соответствии с правилами сайта.", "COMPLETE")),
  c("PD-008-F03", "PD-008", "FAIL", "ABSENT", "Consent says data is processed but not why.", consent("Отправляя форму, вы разрешаете оператору обрабатывать указанные персональные данные.", "COMPLETE")),
  c("PD-008-M01", "PD-008", "MANUAL_CHECK", "ABSENT", "Fragment is explicitly partial and too short to decide.", consent("Согласен с условиями.", "PARTIAL")),
  c("PD-008-M02", "PD-008", "MANUAL_CHECK", "ABSENT", "Text refers to an omitted linked document.", consent("Согласие предоставляется на условиях, указанных в документе по ссылке ниже.", "PARTIAL")),

  c("PD-009-P01", "PD-009", "PASS", "PRESENT", "Consent scope is limited to request processing.", consent("Согласие дается на обработку имени и телефона для ответа на заявку.")),
  c("PD-009-P02", "PD-009", "PASS", "PRESENT", "Word any is limited by request context.", consent("Согласен на любые действия с данными, указанными в этой заявке, необходимые для подготовки ответа.")),
  c("PD-009-P03", "PD-009", "PASS", "PRESENT", "Consent names limited data categories.", consent("Оператор обрабатывает имя, телефон и электронную почту для оформления заказа.")),
  c("PD-009-F01", "PD-009", "FAIL", "ABSENT", "Consent allows any data for any purpose.", consent("Согласен на обработку любых персональных данных для любых целей любыми способами.", "COMPLETE")),
  c("PD-009-F02", "PD-009", "FAIL", "ABSENT", "Consent gives unlimited processing actions without context.", consent("Пользователь разрешает оператору совершать любые действия с любыми данными без ограничений.", "COMPLETE")),
  c("PD-009-F03", "PD-009", "FAIL", "ABSENT", "Consent has no concrete processing scope.", consent("Я даю согласие на обработку персональных данных в полном объеме.", "COMPLETE")),
  c("PD-009-M01", "PD-009", "MANUAL_CHECK", "ABSENT", "Partial fragment cannot prove unlimited scope.", consent("Согласен на обработку данных.", "PARTIAL")),
  c("PD-009-M02", "PD-009", "MANUAL_CHECK", "AMBIGUOUS", "Scope is vague but not clearly unlimited.", consent("Согласен на обработку данных в рамках взаимодействия с сайтом.")),

  c("PD-010-P01", "PD-010", "PASS", "PRESENT", "Marketing consent has a separate optional control.", marketing("Отдельный необязательный флажок: хочу получать рекламные сообщения и акции.")),
  c("PD-010-P02", "PD-010", "PASS", "PRESENT", "Marketing checkbox is separate from offer checkbox.", marketing("Флажок 1: принимаю оферту. Флажок 2: согласен получать рекламную рассылку.")),
  c("PD-010-P03", "PD-010", "PASS", "PRESENT", "Marketing consent is separate from PD consent.", marketing("Флажок 1: согласен на обработку персональных данных. Флажок 2: согласен получать новости и специальные предложения.")),
  c("PD-010-F01", "PD-010", "FAIL", "ABSENT", "One checkbox combines PD consent and marketing.", marketing("Один обязательный флажок: согласен на обработку персональных данных и получение рекламной рассылки.", "COMPLETE")),
  c("PD-010-F02", "PD-010", "FAIL", "ABSENT", "One checkbox combines offer acceptance and marketing.", marketing("Нажимая кнопку, принимаю оферту и соглашаюсь получать рекламные сообщения.", "COMPLETE")),
  c("PD-010-F03", "PD-010", "FAIL", "ABSENT", "Marketing is bundled into user agreement acceptance.", marketing("Принимаю пользовательское соглашение, включая согласие на маркетинговые сообщения.", "COMPLETE")),
  c("PD-010-M01", "PD-010", "MANUAL_CHECK", "ABSENT", "Partial fragment cannot prove marketing consent separation.", marketing("Согласен получать сообщения.", "PARTIAL")),
  c("PD-010-M02", "PD-010", "MANUAL_CHECK", "AMBIGUOUS", "Wording is marketing-like but separation is unclear.", marketing("Подтверждаю согласие на условия и уведомления сайта.")),

  c("PD-013-P01", "PD-013", "PASS", "PRESENT", "Policy lists communication and service purposes.", policy("Оператор обрабатывает персональные данные для ответа на обращения, предоставления сервиса и исполнения договора с пользователем.")),
  c("PD-013-P02", "PD-013", "PASS", "PRESENT", "Policy lists order and support purposes.", policy("Целями обработки являются оформление заказов, доставка, клиентская поддержка и направление сервисных уведомлений.")),
  c("PD-013-P03", "PD-013", "PASS", "PRESENT", "Policy lists account and feedback purposes.", policy("Данные используются для создания учетной записи, идентификации пользователя и обработки обратной связи.")),
  c("PD-013-F01", "PD-013", "FAIL", "ABSENT", "Complete synthetic policy omits purposes.", policy("Настоящая политика описывает порядок обработки персональных данных оператором. Оператор принимает необходимые меры защиты.", false, "COMPLETE")),
  c("PD-013-F02", "PD-013", "FAIL", "ABSENT", "Complete synthetic policy has legal boilerplate but no purposes.", policy("Персональные данные обрабатываются законно и добросовестно. Пользователь может ознакомиться с настоящим документом.", false, "COMPLETE")),
  c("PD-013-F03", "PD-013", "FAIL", "ABSENT", "Complete synthetic policy contains only definitions.", policy("Персональные данные - любая информация, относящаяся к физическому лицу. Оператор - владелец сайта.", false, "COMPLETE")),
  c("PD-013-M01", "PD-013", "MANUAL_CHECK", "ABSENT", "Policy excerpt is incomplete.", policy("Раздел целей обработки приведен в полной версии документа.", true, "TRUNCATED")),
  c("PD-013-M02", "PD-013", "MANUAL_CHECK", "AMBIGUOUS", "Text is too ambiguous.", policy("Информация используется в рамках взаимодействия с сайтом.")),

  c("PD-014-P01", "PD-014", "PASS", "PRESENT", "Policy lists identity and contact categories.", policy("Оператор обрабатывает следующие категории данных: имя, номер телефона, адрес электронной почты и текст обращения.")),
  c("PD-014-P02", "PD-014", "PASS", "PRESENT", "Policy lists account and delivery categories.", policy("К обрабатываемым данным относятся ФИО, контактный телефон, адрес доставки, сведения о заказе и адрес электронной почты.")),
  c("PD-014-P03", "PD-014", "PASS", "PRESENT", "Policy gives concrete examples of data.", policy("Сайт может получать имя пользователя, компанию, должность, рабочий e-mail и содержание сообщения.")),
  c("PD-014-F01", "PD-014", "FAIL", "ABSENT", "Complete synthetic policy has no data categories.", policy("Оператор осуществляет обработку персональных данных с соблюдением требований безопасности и конфиденциальности.", false, "COMPLETE")),
  c("PD-014-F02", "PD-014", "FAIL", "ABSENT", "Complete synthetic policy mentions data generally only.", policy("На сайте могут обрабатываться персональные данные, необходимые для работы сервиса.", false, "COMPLETE")),
  c("PD-014-F03", "PD-014", "FAIL", "ABSENT", "Complete synthetic policy describes only rights and duties.", policy("Пользователь вправе получать сведения об обработке и направлять обращения оператору.", false, "COMPLETE")),
  c("PD-014-M01", "PD-014", "MANUAL_CHECK", "ABSENT", "Potential categories are truncated.", policy("Категории обрабатываемых данных указаны далее в документе.", true, "TRUNCATED")),
  c("PD-014-M02", "PD-014", "MANUAL_CHECK", "AMBIGUOUS", "Wording is too vague.", policy("Обрабатываются сведения, предоставленные пользователем при использовании сайта.")),

  c("PD-015-P01", "PD-015", "PASS", "PRESENT", "Policy states retention until purpose achieved.", policy("Персональные данные хранятся до достижения целей обработки, после чего удаляются или обезличиваются.")),
  c("PD-015-P02", "PD-015", "PASS", "PRESENT", "Policy states storage term and deletion.", policy("Данные заявки хранятся три года, затем уничтожаются, если более длительный срок не требуется законом.")),
  c("PD-015-P03", "PD-015", "PASS", "PRESENT", "Policy states withdrawal/deletion handling.", policy("При отзыве согласия оператор прекращает обработку и удаляет данные в течение установленного внутреннего срока.")),
  c("PD-015-F01", "PD-015", "FAIL", "ABSENT", "Complete synthetic policy lacks retention/deletion handling.", policy("Оператор собирает и защищает персональные данные пользователей сайта.", false, "COMPLETE")),
  c("PD-015-F02", "PD-015", "FAIL", "ABSENT", "Complete synthetic policy describes only security measures.", policy("Для защиты данных применяются организационные и технические меры, ограничение доступа и контроль действий сотрудников.", false, "COMPLETE")),
  c("PD-015-F03", "PD-015", "FAIL", "ABSENT", "Complete synthetic policy describes only categories and purposes.", policy("Данные используются для обратной связи и включают имя, телефон и электронную почту.", false, "COMPLETE")),
  c("PD-015-M01", "PD-015", "MANUAL_CHECK", "ABSENT", "Retention section is outside truncated excerpt.", policy("Сроки хранения персональных данных описаны в следующем разделе документа.", true, "TRUNCATED")),
  c("PD-015-M02", "PD-015", "PASS", "PRESENT", "Rule is a presence-check and the statement provides storage-duration handling, without claiming legal sufficiency.", policy("Данные хранятся в течение периода, необходимого для работы сайта.", false, "PARTIAL")),

  c("PD-016-P01", "PD-016", "PASS", "PRESENT", "Policy gives email request path.", policy("Субъект персональных данных может направить запрос на доступ, исправление или удаление данных на адрес privacy@example.test.")),
  c("PD-016-P02", "PD-016", "PASS", "PRESENT", "Policy describes written request procedure.", policy("Для отзыва согласия или уточнения данных пользователь направляет письменное обращение оператору с указанием контактного адреса.")),
  c("PD-016-P03", "PD-016", "PASS", "PRESENT", "Policy provides form/contact for rights requests.", policy("Запросы о блокировании, исправлении или удалении данных принимаются через форму обратной связи и рассматриваются оператором.")),
  c("PD-016-F01", "PD-016", "FAIL", "ABSENT", "Complete synthetic policy omits subject request procedure.", policy("Оператор обрабатывает данные пользователей сайта и обеспечивает их конфиденциальность.", false, "COMPLETE")),
  c("PD-016-F02", "PD-016", "FAIL", "ABSENT", "Complete synthetic policy describes purposes and categories only.", policy("Цели обработки - доставка заказа и клиентская поддержка. Категории данных: имя, телефон, адрес доставки.", false, "COMPLETE")),
  c("PD-016-F03", "PD-016", "FAIL", "ABSENT", "Complete synthetic policy has operator duties but no request route.", policy("Оператор принимает меры для защиты данных и назначает ответственных лиц за организацию обработки.", false, "COMPLETE")),
  c("PD-016-M01", "PD-016", "MANUAL_CHECK", "ABSENT", "Procedure may be in truncated section.", policy("Порядок направления запросов субъектов персональных данных приведен далее.", true, "TRUNCATED")),
  c("PD-016-M02", "PD-016", "MANUAL_CHECK", "ABSENT", "Reference to external procedure is insufficient.", policy("Права пользователя реализуются в порядке, опубликованном в отдельном документе."))]

export function buildBenchmarkInput(testCase: PilotBenchmarkCase): SemanticEvaluationInput {
  const rule = ruleCriteria.get(testCase.ruleId);
  if (!rule) {
    throw new Error(`Unknown benchmark rule ${testCase.ruleId}`);
  }

  return {
    ruleId: testCase.ruleId,
    ruleVersion: rule.version,
    criterion: rule.criterion,
    evidence: testCase.evidence.map((item, index) => ({
      ref: `${item.factType}:${index + 1}`,
      evidenceId: `evidence-${index + 1}`,
      evidenceType: "TEXT_FRAGMENT",
      pageUrl: "https://synthetic.example/evidence",
      excerpt: item.excerpt,
      completeness: item.completeness,
      metadata: {
        factType: item.factType,
        sourceUrl: "https://synthetic.example/evidence",
        truncated: item.truncated === true,
        originalTextLength: item.excerpt.length,
        maxChars: item.truncated ? 50_000 : item.excerpt.length
      }
    })),
    context: { siteType: "B2B", synthetic: true }
  };
}

function c(
  caseId: string,
  ruleId: PilotBenchmarkRuleId,
  expected: BenchmarkExpectedVerdict,
  expectedObservation: BenchmarkExpectedObservation,
  manualRationale: string,
  evidence: BenchmarkEvidence
): PilotBenchmarkCase {
  return { caseId, ruleId, expected, expectedObservation, manualRationale, evidence: [evidence] };
}

function consent(excerpt: string, completeness: SemanticEvidenceCompleteness = "UNKNOWN"): BenchmarkEvidence {
  return { factType: "consent_text", excerpt, completeness };
}

function marketing(excerpt: string, completeness: SemanticEvidenceCompleteness = "UNKNOWN"): BenchmarkEvidence {
  return { factType: "marketing_consent_control_found", excerpt, completeness };
}

function policy(
  excerpt: string,
  truncated = false,
  completeness: SemanticEvidenceCompleteness = truncated ? "TRUNCATED" : "UNKNOWN"
): BenchmarkEvidence {
  return { factType: "privacy_policy_text", excerpt, truncated, completeness };
}
