import { loadPilotSemanticRuntimeRules } from "@/legal-rules/runtime";
import type { SemanticEvaluationInput, SemanticEvaluationStatus, SemanticEvidenceCompleteness, SemanticObservation } from "./types";

export type PilotBenchmarkRuleId =
  | "PD-005"
  | "PD-008"
  | "PD-009"
  | "PD-010"
  | "CK-001"
  | "CK-004"
  | "PD-013"
  | "PD-014"
  | "PD-015"
  | "PD-016"
  | "PD-017"
  | "PD-018"
  | "PD-019"
  | "PD-024"
  | "EC-010"
  | "EC-012"
  | "EC-014"
  | "EC-015"
  | "EC-016"
  | "REC-003"
  | "LANG-001";
export type BenchmarkExpectedVerdict = SemanticEvaluationStatus;
export type BenchmarkExpectedObservation = SemanticObservation;

export interface BenchmarkEvidence {
  factType:
    | "consent_text"
    | "privacy_policy_text"
    | "marketing_consent_control_found"
    | "rendered_marketing_consent_found"
    | "rendered_consent_text"
    | "cookie_metadata"
    | "local_storage_keys"
    | "network_request_hosts"
    | "form_fields"
    | "external_service_matches"
    | "consumer_page_text"
    | "paid_addon_control_found"
    | "recommendation_rules_text";
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

  cMany("CK-001-P01", "CK-001", "PASS", "PRESENT", "Policy discloses analytics cookies and purposes.", [cookieEvidence("Browser cookies: _ga, _gid. Network host: google-analytics.com.", "COMPLETE"), policy("Политика сообщает об использовании cookie и идентификаторов аналитики для статистики посещений.", false, "COMPLETE")]),
  cMany("CK-001-P02", "CK-001", "PASS", "PRESENT", "Policy discloses advertising identifiers.", [cookieEvidence("Browser cookies: _fbp. External advertising pixel detected.", "COMPLETE"), policy("В политике указаны рекламные cookie и пиксели для показа релевантной рекламы.", false, "COMPLETE")]),
  cMany("CK-001-P03", "CK-001", "PASS", "PRESENT", "Policy discloses marketing storage identifiers by category.", [storageEvidence("localStorage keys: marketingClientId, visitorId.", "COMPLETE"), policy("Сайт использует идентификаторы браузера для маркетинговых коммуникаций и персонализации.", false, "COMPLETE")]),
  cMany("CK-001-F01", "CK-001", "FAIL", "ABSENT", "Complete policy omits analytics cookies.", [cookieEvidence("Browser cookies: _ym_uid. External analytics service Yandex Metrica detected.", "COMPLETE"), policy("Политика описывает только обработку заявок и не упоминает cookie, аналитику, идентификаторы или технологии отслеживания.", false, "COMPLETE")]),
  cMany("CK-001-F02", "CK-001", "FAIL", "ABSENT", "Complete policy omits advertising tracker identifiers.", [cookieEvidence("Browser cookies: _fbp, _fbc. Advertising pixel detected.", "COMPLETE"), policy("Политика описывает цели заказа и обратной связи без сведений о рекламных технологиях или идентификаторах.", false, "COMPLETE")]),
  cMany("CK-001-F03", "CK-001", "FAIL", "ABSENT", "Complete policy omits storage-based tracking.", [storageEvidence("localStorage keys: analytics_uid, visitor_tracking_id.", "COMPLETE"), policy("Политика не содержит сведений о cookie, локальном хранилище, аналитике или отслеживании.", false, "COMPLETE")]),
  cMany("CK-001-M01", "CK-001", "MANUAL_CHECK", "ABSENT", "Incomplete policy cannot prove omission.", [cookieEvidence("Browser cookies: _ga.", "COMPLETE"), policy("Раздел о cookie приведён далее.", true, "TRUNCATED")]),
  cMany("CK-001-M02", "CK-001", "MANUAL_CHECK", "AMBIGUOUS", "Policy wording is too generic.", [cookieEvidence("Browser cookies: session_id, visitorId.", "UNKNOWN"), policy("Сайт может использовать технические файлы для работы сервиса.")]),

  c("CK-004-P01", "CK-004", "PASS", "PRESENT", "Cookie consent has a separate optional checkbox.", renderedConsent("Флажок 1: принимаю оферту. Флажок 2: необязательно согласен на cookie аналитики.")),
  c("CK-004-P02", "CK-004", "PASS", "PRESENT", "Analytics consent is separate from personal-data consent.", renderedConsent("Флажок 1: согласен на обработку персональных данных. Флажок 2: согласен на использование аналитических cookie.")),
  c("CK-004-P03", "CK-004", "PASS", "PRESENT", "Marketing tracking consent is optional and separate.", renderedConsent("Отдельный необязательный флажок: разрешаю маркетинговые технологии и рекламные cookie.")),
  c("CK-004-F01", "CK-004", "FAIL", "ABSENT", "One mandatory checkbox combines offer and analytics cookies.", renderedConsent("Один обязательный флажок: принимаю оферту и соглашаюсь на cookie аналитики.", "COMPLETE")),
  c("CK-004-F02", "CK-004", "FAIL", "ABSENT", "One control combines PD consent and marketing trackers.", renderedConsent("Один флажок: согласен на обработку персональных данных и рекламные cookie.", "COMPLETE")),
  c("CK-004-F03", "CK-004", "FAIL", "ABSENT", "Tracking consent is bundled into user agreement.", renderedConsent("Принимаю пользовательское соглашение, включая согласие на аналитические и маркетинговые технологии.", "COMPLETE")),
  c("CK-004-M01", "CK-004", "MANUAL_CHECK", "ABSENT", "Partial fragment cannot prove bundling.", renderedConsent("Согласен с условиями и cookie.", "PARTIAL")),
  c("CK-004-M02", "CK-004", "MANUAL_CHECK", "AMBIGUOUS", "Wording is unclear.", renderedConsent("Подтверждаю настройки сайта и условия.")),

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
  c("PD-016-M02", "PD-016", "MANUAL_CHECK", "ABSENT", "Reference to external procedure is insufficient.", policy("Права пользователя реализуются в порядке, опубликованном в отдельном документе.")),

  cMany("PD-017-P01", "PD-017", "PASS", "PRESENT", "Form name and email are reflected in policy.", [form("Форма заявки собирает персональные данные: имя, электронная почта."), policy("Политика указывает категории данных: имя и адрес электронной почты.", false, "COMPLETE")]),
  cMany("PD-017-P02", "PD-017", "PASS", "PRESENT", "Equivalent wording for phone and email is sufficient.", [form("Форма обратной связи собирает телефон и e-mail."), policy("Оператор обрабатывает контактные данные: номер телефона и электронную почту.", false, "COMPLETE")]),
  cMany("PD-017-P03", "PD-017", "PASS", "PRESENT", "Technical hidden field is not included as personal data.", [form("Форма заказа собирает имя и телефон. Техническое hidden поле csrf не относится к персональным данным."), policy("В политике указаны имя и телефон.", false, "COMPLETE")]),
  cMany("PD-017-F01", "PD-017", "FAIL", "ABSENT", "Date of birth collected by form is missing from complete policy.", [form("Форма регистрации собирает имя, телефон и дату рождения."), policy("Политика указывает категории данных: имя и телефон.", false, "COMPLETE")]),
  cMany("PD-017-F02", "PD-017", "FAIL", "ABSENT", "Address collected by form is missing from complete policy.", [form("Форма доставки собирает имя, телефон и адрес доставки."), policy("Политика описывает имя и номер телефона.", false, "COMPLETE")]),
  cMany("PD-017-F03", "PD-017", "FAIL", "ABSENT", "Email collected by form is missing from complete policy.", [form("Форма заявки собирает имя и электронную почту."), policy("Политика описывает только имя пользователя.", false, "COMPLETE")]),
  cMany("PD-017-M01", "PD-017", "MANUAL_CHECK", "ABSENT", "Incomplete policy cannot prove omission.", [form("Форма собирает имя, телефон и дату рождения."), policy("Категории данных перечислены далее.", true, "TRUNCATED")]),
  cMany("PD-017-M02", "PD-017", "MANUAL_CHECK", "AMBIGUOUS", "Policy wording is too generic.", [form("Форма собирает имя и телефон."), policy("Оператор обрабатывает сведения, предоставленные пользователем.")]),

  cMany("PD-018-P01", "PD-018", "PASS", "PRESENT", "Relevant service disclosed by name.", [service("Найден внешний сервис: Yandex Metrica, категория analytics."), policy("Политика указывает, что сайт использует Яндекс Метрику для аналитики.", false, "COMPLETE")]),
  cMany("PD-018-P02", "PD-018", "PASS", "PRESENT", "Relevant service disclosed by category.", [service("Найден внешний сервис: MailerLite, категория email_marketing."), policy("Политика раскрывает передачу данных сервисам рассылки и email-маркетинга.", false, "COMPLETE")]),
  cMany("PD-018-P03", "PD-018", "PASS", "PRESENT", "Payment provider category is enough.", [service("Найден внешний сервис: CloudPayments, категория payment."), policy("Для оплаты заказов данные могут передаваться платежному оператору.", false, "COMPLETE")]),
  cMany("PD-018-F01", "PD-018", "FAIL", "ABSENT", "Relevant analytics service is not disclosed.", [service("Найден внешний сервис: Yandex Metrica, категория analytics."), policy("Политика описывает только внутреннюю обработку заявок и не упоминает аналитику или внешних обработчиков.", false, "COMPLETE")]),
  cMany("PD-018-F02", "PD-018", "FAIL", "ABSENT", "Relevant mailing service is not disclosed.", [service("Найден внешний сервис: Unisender, категория email_marketing."), policy("Политика описывает обработку данных оператором без получателей и сервисов рассылки.", false, "COMPLETE")]),
  cMany("PD-018-F03", "PD-018", "FAIL", "ABSENT", "Relevant CRM service is not disclosed.", [service("Найден внешний сервис: Bitrix24, категория CRM."), policy("Политика перечисляет цели и категории данных, но не раскрывает CRM или иных обработчиков.", false, "COMPLETE")]),
  cMany("PD-018-M01", "PD-018", "MANUAL_CHECK", "ABSENT", "Incomplete policy cannot prove service omission.", [service("Найден внешний сервис: Yandex Metrica, категория analytics."), policy("Раздел о третьих лицах приведен далее.", true, "TRUNCATED")]),
  cMany("PD-018-M02", "PD-018", "MANUAL_CHECK", "AMBIGUOUS", "Service relevance or policy category is ambiguous.", [service("Найден внешний технический сервис: static CDN, категория technical_asset.", "UNKNOWN"), policy("Политика допускает использование технических сервисов для работы сайта.")]),

  cMany("PD-019-P01", "PD-019", "PASS", "PRESENT", "No-transfer claim is consistent with no contradictory relevant processor.", [service("Найден только технический CDN без признака обработки персональных данных.", "COMPLETE"), policy("Персональные данные третьим лицам не передаются.", false, "COMPLETE")]),
  cMany("PD-019-P02", "PD-019", "PASS", "PRESENT", "No-transfer claim is consistent with internal-only service evidence.", [service("Внешние обработчики персональных данных не подтверждены.", "COMPLETE"), policy("Оператор не предоставляет персональные данные третьим лицам.", false, "COMPLETE")]),
  cMany("PD-019-P03", "PD-019", "PASS", "PRESENT", "Foreign technical asset alone is not contradiction.", [service("Найден иностранный CDN как технический asset без подтвержденной обработки персональных данных.", "COMPLETE"), policy("Персональные данные третьим сторонам не раскрываются.", false, "COMPLETE")]),
  cMany("PD-019-F01", "PD-019", "FAIL", "ABSENT", "No-transfer claim contradicts confirmed analytics processor.", [service("Найден подтвержденный внешний обработчик: Yandex Metrica, категория analytics."), policy("Персональные данные третьим лицам не передаются.", false, "COMPLETE")]),
  cMany("PD-019-F02", "PD-019", "FAIL", "ABSENT", "No-transfer claim contradicts confirmed mailing processor.", [service("Найден подтвержденный внешний обработчик: Unisender, категория email_marketing."), policy("Оператор не предоставляет персональные данные третьим лицам.", false, "COMPLETE")]),
  cMany("PD-019-F03", "PD-019", "FAIL", "ABSENT", "No-transfer claim contradicts confirmed CRM processor.", [service("Найден подтвержденный внешний обработчик: Bitrix24, категория CRM."), policy("Персональные данные третьим сторонам не раскрываются.", false, "COMPLETE")]),
  cMany("PD-019-M01", "PD-019", "MANUAL_CHECK", "AMBIGUOUS", "Relevance is ambiguous.", [service("Найден внешний сервис, но связь с обработкой персональных данных не подтверждена.", "UNKNOWN"), policy("Персональные данные третьим лицам не передаются.", false, "COMPLETE")]),
  cMany("PD-019-M02", "PD-019", "MANUAL_CHECK", "ABSENT", "Incomplete service evidence cannot prove contradiction.", [service("Возможно используется внешний обработчик аналитики.", "PARTIAL"), policy("Персональные данные третьим лицам не передаются.", false, "COMPLETE")]),

  c("PD-024-P01", "PD-024", "PASS", "ABSENT", "Ordinary contact form has no special-category signal.", form("Форма консультации: имя, телефон, электронная почта.", "COMPLETE")),
  c("PD-024-P02", "PD-024", "PASS", "ABSENT", "Order form collects ordinary delivery data.", form("Форма заказа: ФИО, телефон, адрес доставки.", "COMPLETE")),
  c("PD-024-P03", "PD-024", "PASS", "ABSENT", "Health topic page is not a form field collection signal.", form("Страница услуги медицинского центра содержит форму: имя и телефон для записи.", "COMPLETE")),
  c("PD-024-F01", "PD-024", "MANUAL_CHECK", "PRESENT", "Form asks for diagnosis.", form("Форма записи содержит поле: диагноз или жалобы пациента.", "COMPLETE")),
  c("PD-024-F02", "PD-024", "MANUAL_CHECK", "PRESENT", "Form asks for disability status.", form("Анкета содержит поле: инвалидность, группа инвалидности.", "COMPLETE")),
  c("PD-024-F03", "PD-024", "MANUAL_CHECK", "PRESENT", "Form asks for religious belief information.", form("Форма сообщества содержит поле: религиозные убеждения.", "COMPLETE")),
  c("PD-024-M01", "PD-024", "MANUAL_CHECK", "AMBIGUOUS", "Medical wording is unclear.", form("Форма содержит поле: профиль здоровья.", "UNKNOWN")),
  c("PD-024-M02", "PD-024", "MANUAL_CHECK", "ABSENT", "Partial form evidence cannot prove absence.", form("Фрагмент формы: имя.", "PARTIAL")),

  c("EC-010-P01", "EC-010", "PASS", "PRESENT", "Consumer page gives complaint email.", consumer("Претензии и жалобы по заказу можно направить на адрес claim@example.test.")),
  c("EC-010-P02", "EC-010", "PASS", "PRESENT", "Return page describes written claim procedure.", consumer("Для возврата товара покупатель направляет заявление и претензию через форму обратной связи.")),
  c("EC-010-P03", "EC-010", "PASS", "PRESENT", "Offer explains appeals channel.", consumer("Обращения и жалобы покупателей принимаются в личном кабинете или по адресу поддержки.")),
  c("EC-010-F01", "EC-010", "FAIL", "ABSENT", "Complete consumer text has only payment and delivery.", consumer("Оплата производится картой. Доставка выполняется курьером. Срок доставки два дня.", "COMPLETE")),
  c("EC-010-F02", "EC-010", "FAIL", "ABSENT", "Complete offer omits complaints.", consumer("Оферта описывает товар, цену и порядок оплаты без порядка претензий.", "COMPLETE")),
  c("EC-010-F03", "EC-010", "FAIL", "ABSENT", "General contacts alone are not complaint procedure.", consumer("Контакты магазина: info@example.test, телефон +7 999 000-00-00.", "COMPLETE")),
  c("EC-010-M01", "EC-010", "MANUAL_CHECK", "ABSENT", "Partial page cannot prove absence.", consumer("Раздел обращений приведён ниже.", "PARTIAL")),
  c("EC-010-M02", "EC-010", "MANUAL_CHECK", "AMBIGUOUS", "Support wording is unclear.", consumer("По всем вопросам используйте удобный способ связи.")),

  c("EC-012-P01", "EC-012", "PASS", "PRESENT", "Paid add-on can be removed.", addon("В корзине добавлена платная гарантия; рядом кнопка убрать, заказ можно оформить без неё.", "COMPLETE")),
  c("EC-012-P02", "EC-012", "PASS", "PRESENT", "Optional service is selectable.", addon("Дополнительная настройка товара предлагается как необязательная услуга с возможностью отказаться.", "COMPLETE")),
  c("EC-012-P03", "EC-012", "PASS", "PRESENT", "Preselected but removable add-on is not mandatory here.", addon("Платная страховка предварительно выбрана, но пользователь может снять выбор и продолжить покупку.", "COMPLETE")),
  c("EC-012-F01", "EC-012", "FAIL", "ABSENT", "Checkout says paid service is required.", addon("Для оформления заказа необходимо приобрести платную настройку; без неё продолжить нельзя.", "COMPLETE")),
  c("EC-012-F02", "EC-012", "FAIL", "ABSENT", "Add-on cannot be removed.", addon("Платная гарантия включена в заказ и не может быть удалена из корзины.", "COMPLETE")),
  c("EC-012-F03", "EC-012", "FAIL", "ABSENT", "Main purchase is conditioned on paid package.", addon("Товар продаётся только вместе с обязательным сервисным пакетом за отдельную плату.", "COMPLETE")),
  c("EC-012-M01", "EC-012", "MANUAL_CHECK", "AMBIGUOUS", "Paid add-on shown but optionality unclear.", addon("В корзине отображается платная услуга упаковки.")),
  c("EC-012-M02", "EC-012", "MANUAL_CHECK", "ABSENT", "Partial checkout fragment cannot prove mandatory nature.", addon("Продолжение оформления заказа недоступно.", "PARTIAL")),

  c("EC-014-P01", "EC-014", "PASS", "PRESENT", "Product page gives name and substantive properties.", consumer("Карточка товара: Смартфон X. Экран 6.5 дюйма, память 128 ГБ, камера 50 Мп, комплект поставки и гарантия указаны.", "COMPLETE")),
  c("EC-014-P02", "EC-014", "PASS", "PRESENT", "Service product page describes contents.", consumer("Услуга настройки: состав работ, сроки выполнения, результат и ограничения услуги описаны на странице товара.", "COMPLETE")),
  c("EC-014-P03", "EC-014", "PASS", "PRESENT", "Product page has meaningful consumer details.", consumer("Карточка: кресло офисное. Материал, размеры, максимальная нагрузка, цвет и условия сборки указаны.", "COMPLETE")),
  c("EC-014-F01", "EC-014", "FAIL", "ABSENT", "Complete product card has only name and buy button.", consumer("Карточка товара: Товар 123. Цена 1990 руб. Купить.", "COMPLETE")),
  c("EC-014-F02", "EC-014", "FAIL", "ABSENT", "Complete product card is empty placeholder.", consumer("Страница товара: изображение недоступно, описание отсутствует, характеристики отсутствуют, кнопка Купить.", "COMPLETE")),
  c("EC-014-F03", "EC-014", "FAIL", "ABSENT", "Complete product card lacks substantive info.", consumer("Карточка услуги: Пакет Стандарт. Цена 5000 руб. Оформить заказ. Описание не заполнено.", "COMPLETE")),
  c("EC-014-M01", "EC-014", "MANUAL_CHECK", "ABSENT", "Partial product page cannot prove absence.", consumer("Карточка товара: описание ниже.", "PARTIAL")),
  c("EC-014-M02", "EC-014", "MANUAL_CHECK", "AMBIGUOUS", "Category-specific sufficiency is unclear.", consumer("Карточка товара содержит краткое описание модели, но неясно, какие характеристики важны для этой категории.")),

  c("EC-015-P01", "EC-015", "PASS", "PRESENT", "Offer discloses ordering, payment and delivery.", consumer("Оферта: заказ оформляется через корзину, оплата банковской картой, доставка курьером по указанному адресу в течение 3 дней.", "COMPLETE")),
  c("EC-015-P02", "EC-015", "PASS", "PRESENT", "Product page discloses pickup and payment terms.", consumer("На странице товара указано: самовывоз из магазина, оплата онлайн или при получении, заказ подтверждается после оплаты.", "COMPLETE")),
  c("EC-015-P03", "EC-015", "PASS", "PRESENT", "Checkout text has applicable terms.", consumer("Корзина: выберите способ получения, адрес доставки, способ оплаты и подтвердите заказ после проверки условий.", "COMPLETE")),
  c("EC-015-F01", "EC-015", "FAIL", "ABSENT", "Complete materials offer delivery but omit delivery terms.", consumer("Интернет-магазин предлагает доставку товара, но публичные условия содержат только цену товара и кнопку купить без условий оплаты и доставки.", "COMPLETE")),
  c("EC-015-F02", "EC-015", "FAIL", "ABSENT", "Complete pre-contract text omits payment terms for online order.", consumer("Оферта описывает оформление заказа и доставку, но не содержит условий оплаты при дистанционной продаже.", "COMPLETE")),
  c("EC-015-F03", "EC-015", "FAIL", "ABSENT", "Complete checkout material omits applicable acquisition terms.", consumer("Checkout page shows product total and delivery is offered, but no purchase, payment, transfer or delivery terms are disclosed.", "COMPLETE")),
  c("EC-015-M01", "EC-015", "MANUAL_CHECK", "ABSENT", "Partial checkout cannot prove omission.", consumer("Корзина: условия доставки указаны далее.", "PARTIAL")),
  c("EC-015-M02", "EC-015", "MANUAL_CHECK", "AMBIGUOUS", "Delivery applicability is unclear.", consumer("На сайте указано: получение обсуждается с менеджером после заказа.")),

  c("EC-016-P01", "EC-016", "PASS", "PRESENT", "Return terms contain no explicit contradiction.", consumer("Возврат товара дистанционной продажи осуществляется по заявлению покупателя, стоимость возвращается в установленный законом срок.", "COMPLETE")),
  c("EC-016-P02", "EC-016", "PASS", "PRESENT", "Refund terms look consistent.", consumer("Покупатель может отказаться от товара в порядке, предусмотренном законом; возврат денежных средств производится после получения товара.", "COMPLETE")),
  c("EC-016-P03", "EC-016", "PASS", "PRESENT", "Return page has neutral lawful wording.", consumer("Условия возврата применяются с учетом правил дистанционной продажи и Закона о защите прав потребителей.", "COMPLETE")),
  c("EC-016-F01", "EC-016", "FAIL", "ABSENT", "Return costs always shifted to consumer.", consumer("При любом возврате расходы по возврату товара всегда несет потребитель, включая случаи, когда такие расходы должен нести продавец.", "COMPLETE")),
  c("EC-016-F02", "EC-016", "FAIL", "ABSENT", "Return impossible under any circumstances.", consumer("Возврат товара дистанционной продажи невозможен при любых условиях, денежные средства не возвращаются.", "COMPLETE")),
  c("EC-016-F03", "EC-016", "FAIL", "ABSENT", "Refund explicitly denied categorically.", consumer("Refunds are not available under any circumstances for distance sale orders.", "COMPLETE")),
  c("EC-016-M01", "EC-016", "MANUAL_CHECK", "AMBIGUOUS", "Return terms absent from public evidence.", consumer("Оферта описывает товар, оплату и доставку, но публичные условия возврата не представлены.", "COMPLETE")),
  c("EC-016-M02", "EC-016", "MANUAL_CHECK", "ABSENT", "Incomplete return document cannot prove contradiction.", consumer("Раздел возврата приведён далее.", "PARTIAL")),

  c("REC-003-P01", "REC-003", "PASS", "PRESENT", "Russian rules text is accessible.", recommenderRules("Правила применения рекомендательных технологий опубликованы на русском языке и доступны без входа.")),
  c("REC-003-P02", "REC-003", "PASS", "PRESENT", "Russian equivalent is present.", recommenderRules("Rules of recommendation technologies / Правила рекомендательных технологий: документ доступен на русском языке.")),
  c("REC-003-P03", "REC-003", "PASS", "PRESENT", "Public Russian rules page.", recommenderRules("Пользователь может свободно ознакомиться с правилами работы рекомендаций на этой странице.")),
  c("REC-003-F01", "REC-003", "FAIL", "ABSENT", "Rules are foreign-language only.", recommenderRules("Recommendation Technology Rules are available only in English. Русская версия отсутствует.", "COMPLETE")),
  c("REC-003-F02", "REC-003", "FAIL", "ABSENT", "Rules require login.", recommenderRules("Для просмотра правил рекомендательных технологий необходимо войти в личный кабинет.", "COMPLETE")),
  c("REC-003-F03", "REC-003", "FAIL", "ABSENT", "Rules page is unavailable.", recommenderRules("Правила рекомендательных технологий временно недоступны; доступ запрещён.", "COMPLETE")),
  c("REC-003-M01", "REC-003", "MANUAL_CHECK", "AMBIGUOUS", "Rules text is too short.", recommenderRules("Правила рекомендаций.")),
  c("REC-003-M02", "REC-003", "MANUAL_CHECK", "ABSENT", "Partial rules evidence cannot prove unavailability.", recommenderRules("Русская версия размещена далее.", "PARTIAL")),

  c("LANG-001-P01", "LANG-001", "PASS", "PRESENT", "Consumer information is in Russian.", consumer("Доставка, оплата, возврат товара и сведения о продавце указаны на русском языке.", "COMPLETE")),
  c("LANG-001-P02", "LANG-001", "PASS", "PRESENT", "Foreign brand name only is not mandatory consumer info.", consumer("Название товара: Smart Bottle Pro. Условия покупки и возврата указаны на русском языке.", "COMPLETE")),
  c("LANG-001-P03", "LANG-001", "PASS", "PRESENT", "Russian equivalent exists.", consumer("Delivery terms / Условия доставки: курьерская доставка по Москве.", "COMPLETE")),
  c("LANG-001-F01", "LANG-001", "FAIL", "ABSENT", "Mandatory return terms are English-only.", consumer("Return policy: items may be returned within 14 days. Russian translation is not provided.", "COMPLETE")),
  c("LANG-001-F02", "LANG-001", "FAIL", "ABSENT", "Seller information is foreign-only.", consumer("Seller: Example LLC, address and complaint procedure are available only in English.", "COMPLETE")),
  c("LANG-001-F03", "LANG-001", "FAIL", "ABSENT", "Payment and delivery terms are foreign-only.", consumer("Payment and delivery terms are available in English only; no Russian equivalent.", "COMPLETE")),
  c("LANG-001-M01", "LANG-001", "MANUAL_CHECK", "AMBIGUOUS", "Unclear whether text is mandatory consumer information.", consumer("Premium support available worldwide.")),
  c("LANG-001-M02", "LANG-001", "MANUAL_CHECK", "ABSENT", "Partial fragment cannot prove foreign-only mandatory info.", consumer("Return policy:", "PARTIAL"))]

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

function cMany(
  caseId: string,
  ruleId: PilotBenchmarkRuleId,
  expected: BenchmarkExpectedVerdict,
  expectedObservation: BenchmarkExpectedObservation,
  manualRationale: string,
  evidence: BenchmarkEvidence[]
): PilotBenchmarkCase {
  return { caseId, ruleId, expected, expectedObservation, manualRationale, evidence };
}

function consent(excerpt: string, completeness: SemanticEvidenceCompleteness = "UNKNOWN"): BenchmarkEvidence {
  return { factType: "consent_text", excerpt, completeness };
}

function marketing(excerpt: string, completeness: SemanticEvidenceCompleteness = "UNKNOWN"): BenchmarkEvidence {
  return { factType: "marketing_consent_control_found", excerpt, completeness };
}

function renderedConsent(excerpt: string, completeness: SemanticEvidenceCompleteness = "UNKNOWN"): BenchmarkEvidence {
  return { factType: "rendered_consent_text", excerpt, completeness };
}

function cookieEvidence(excerpt: string, completeness: SemanticEvidenceCompleteness = "UNKNOWN"): BenchmarkEvidence {
  return { factType: "cookie_metadata", excerpt, completeness };
}

function storageEvidence(excerpt: string, completeness: SemanticEvidenceCompleteness = "UNKNOWN"): BenchmarkEvidence {
  return { factType: "local_storage_keys", excerpt, completeness };
}

function form(excerpt: string, completeness: SemanticEvidenceCompleteness = "COMPLETE"): BenchmarkEvidence {
  return { factType: "form_fields", excerpt, completeness };
}

function service(excerpt: string, completeness: SemanticEvidenceCompleteness = "COMPLETE"): BenchmarkEvidence {
  return { factType: "external_service_matches", excerpt, completeness };
}

function consumer(excerpt: string, completeness: SemanticEvidenceCompleteness = "UNKNOWN"): BenchmarkEvidence {
  return { factType: "consumer_page_text", excerpt, completeness };
}

function addon(excerpt: string, completeness: SemanticEvidenceCompleteness = "UNKNOWN"): BenchmarkEvidence {
  return { factType: "paid_addon_control_found", excerpt, completeness };
}

function recommenderRules(excerpt: string, completeness: SemanticEvidenceCompleteness = "UNKNOWN"): BenchmarkEvidence {
  return { factType: "recommendation_rules_text", excerpt, completeness };
}

function policy(
  excerpt: string,
  truncated = false,
  completeness: SemanticEvidenceCompleteness = truncated ? "TRUNCATED" : "UNKNOWN"
): BenchmarkEvidence {
  return { factType: "privacy_policy_text", excerpt, truncated, completeness };
}
