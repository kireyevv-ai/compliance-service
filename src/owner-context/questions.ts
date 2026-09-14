import type { OwnerQuestionDefinition } from "./types";

export const OWNER_QUESTIONS: OwnerQuestionDefinition[] = [
  {
    questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
    text: "На каком основании вы обрабатываете данные из этой формы?",
    explanation: "Это нужно, чтобы не считать отсутствие отдельного checkbox нарушением автоматически.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "SEPARATE_CONSENT", label: "Отдельное согласие пользователя" },
      { optionId: "CONTRACT_OR_REQUEST", label: "Договор, заявка или заказ пользователя" },
      { optionId: "LEGAL_REQUIREMENT", label: "Требование закона" },
      { optionId: "OTHER_CONFIRMED_BASIS", label: "Другое подтверждённое основание" },
      { optionId: "NO_BASIS", label: "Основания нет" },
      { optionId: "NO_PD_PROCESSING", label: "Мы не обрабатываем персональные данные из этой формы" }
    ]
  },
  {
    questionId: "Q_MARKETING_CONSENT_PROOF",
    text: "Фиксируете ли вы предварительное согласие пользователя на рекламные или маркетинговые сообщения?",
    explanation: "Для таких сообщений важно подтвердить, что согласие получено заранее и его можно доказать.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "PROOF_STORED", label: "Да, сохраняем дату, источник и текст согласия" },
      { optionId: "WEAK_PROOF", label: "Да, но доказательств недостаточно" },
      { optionId: "NO_PROOF", label: "Нет" },
      { optionId: "NO_MARKETING", label: "Мы не отправляем рекламу или маркетинг" }
    ]
  },
  {
    questionId: "Q_PD_PRIMARY_DB_LOCATION",
    text: "Где происходит первичная запись и хранение персональных данных граждан РФ, полученных через сайт?",
    explanation: "Публичный сайт не показывает, где находится первичная база персональных данных.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "RU_FIRST", label: "В России" },
      { optionId: "FOREIGN_FIRST", label: "Сначала за пределами России" },
      { optionId: "RU_FIRST_FOREIGN_COPIES", label: "Сначала в России, затем копии за рубежом" },
      { optionId: "UNKNOWN_VENDOR", label: "Не знаем или зависит от подрядчика" }
    ]
  },
  {
    questionId: "Q_PD_OPERATOR_RKN_NOTIFICATION",
    text: "Подано ли уведомление оператора персональных данных в Роскомнадзор или есть применимое исключение?",
    explanation: "Обязанность уведомления зависит от оператора, процесса обработки и возможных исключений.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "REGISTRY_PRESENT", label: "Да, уведомление подано и оператор есть в реестре" },
      { optionId: "SUBMITTED_NOT_LISTED", label: "Подано, но ещё не отражено в реестре" },
      { optionId: "EXCEPTION_APPLIES", label: "Есть применимое исключение" },
      { optionId: "NOT_SUBMITTED", label: "Нет" }
    ]
  },
  {
    questionId: "Q_AD_MATERIAL_QUALIFICATION",
    text: "Отмеченные блоки являются интернет-рекламой, размещённой в интересах вашего бизнеса или третьего лица?",
    explanation: "Сервис не должен юридически квалифицировать рекламный материал только по DOM или скриншоту.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "IS_INTERNET_AD", label: "Да, это интернет-реклама" },
      { optionId: "NOT_AD", label: "Нет, это собственная информация, каталог или навигация" }
    ]
  },
  {
    questionId: "Q_AUTH_OWNER_STATUS",
    text: "Владелец ресурса является российским лицом или российской организацией?",
    explanation: "Требование о способах авторизации применяется не ко всем владельцам ресурсов.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "RUSSIAN_OWNER", label: "Да" },
      { optionId: "NOT_RUSSIAN_OWNER", label: "Нет" }
    ]
  },
  {
    questionId: "Q_AUTH_METHODS",
    text: "Какие способы авторизации доступны пользователям из России?",
    explanation: "Если требование применимо, нужно проверить фактически доступные пользователю способы входа.",
    answerType: "MULTI_SELECT",
    required: true,
    allowUnknown: true,
    exclusiveOptionIds: ["NO_AUTH"],
    options: [
      { optionId: "NO_AUTH", label: "Авторизации нет" },
      { optionId: "ESIA", label: "ЕСИА / Госуслуги" },
      { optionId: "ALLOWED_RU_METHOD", label: "Российский номер или иной разрешённый законом способ" },
      { optionId: "LOGIN_PASSWORD_ONLY", label: "Только логин и пароль" },
      { optionId: "FOREIGN_PROVIDERS_ONLY", label: "Только иностранные провайдеры" },
      { optionId: "OTHER", label: "Другое" }
    ]
  },
  {
    questionId: "Q_RECOMMENDER_TECH_USE",
    text: "Использует ли сайт рекомендательные технологии: персональную выдачу, подбор товаров или контента, ранжирование под пользователя?",
    explanation: "Внешние признаки персонализации не всегда доказывают юридическое применение рекомендательных технологий.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "USES_RECOMMENDER_TECH", label: "Да" },
      { optionId: "NO_RECOMMENDER_TECH", label: "Нет" },
      { optionId: "BASIC_SORTING_ONLY", label: "Только обычная сортировка или фильтры без персонализации" }
    ]
  },
  {
    questionId: "Q_LANGUAGE_EXCEPTION",
    text: "Почему этот фрагмент публичной информации оставлен только на иностранном языке?",
    explanation: "Нужно проверить, относится ли фрагмент к исключениям из языкового требования.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "TRADEMARK_OR_BRAND", label: "Это товарный знак или бренд" },
      { optionId: "LEGAL_NAME", label: "Это фирменное наименование" },
      { optionId: "PRODUCT_MODEL_NAME", label: "Это название товара или модели" },
      { optionId: "NOT_MANDATORY_CONSUMER_INFO", label: "Это не обязательная потребительская информация" },
      { optionId: "NO_EXCEPTION", label: "Исключения нет" }
    ]
  }
];

export const OWNER_QUESTION_BY_ID = new Map(OWNER_QUESTIONS.map((question) => [question.questionId, question]));
