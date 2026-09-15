import type { OwnerQuestionDefinition } from "./types";

export const OWNER_QUESTIONS: OwnerQuestionDefinition[] = [
  {
    questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
    text: "На каком основании вы получаете и используете данные из этой формы?",
    explanation: "По информации на сайте нельзя достоверно определить, на каком основании обрабатываются данные из этой формы.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "SEPARATE_CONSENT", label: "Пользователь отдельно соглашается на обработку данных" },
      { optionId: "CONTRACT_OR_REQUEST", label: "Данные нужны, чтобы выполнить заявку, заказ или договор" },
      { optionId: "LEGAL_REQUIREMENT", label: "Обработка этих данных требуется по закону" },
      { optionId: "OTHER_CONFIRMED_BASIS", label: "Есть другое законное основание" },
      { optionId: "NO_BASIS", label: "Законного основания для обработки нет" },
      { optionId: "NO_PD_PROCESSING", label: "Эта форма фактически не используется для сбора данных" }
    ]
  },
  {
    questionId: "Q_MARKETING_CONSENT_PROOF",
    text: "Если вы отправляете рекламные сообщения или рассылки, можете ли вы подтвердить, что пользователь заранее согласился их получать?",
    explanation: "Для рекламных сообщений важно заранее получить согласие пользователя и иметь возможность подтвердить его получение.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "PROOF_STORED", label: "Да, сохраняем подтверждение согласия" },
      { optionId: "WEAK_PROOF", label: "Согласие получаем, но подтверждение сохраняется не полностью" },
      { optionId: "NO_PROOF", label: "Нет, отдельного согласия не получаем" },
      { optionId: "NO_MARKETING", label: "Мы не отправляем рекламные сообщения и рассылки" }
    ]
  },
  {
    questionId: "Q_PD_PRIMARY_DB_LOCATION",
    text: "Где впервые записываются и хранятся персональные данные граждан России, полученные через сайт?",
    explanation: "По сайту нельзя достоверно определить, где находится основная база с персональными данными.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "RU_FIRST", label: "В России" },
      { optionId: "FOREIGN_FIRST", label: "Сначала за пределами России" },
      { optionId: "RU_FIRST_FOREIGN_COPIES", label: "Сначала в России, затем копии за рубежом" },
      { optionId: "UNKNOWN_VENDOR", label: "Не знаем или зависит от исполнителя" }
    ]
  },
  {
    questionId: "Q_PD_OPERATOR_RKN_NOTIFICATION",
    text: "Подавали ли вы уведомление об обработке персональных данных в Роскомнадзор?",
    explanation: "По сайту нельзя достоверно определить, подавалось ли уведомление и есть ли законное исключение.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "REGISTRY_PRESENT", label: "Да, уведомление подано и запись есть в реестре" },
      { optionId: "SUBMITTED_NOT_LISTED", label: "Подано, но записи в реестре пока нет" },
      { optionId: "EXCEPTION_APPLIES", label: "У нас есть законное исключение" },
      { optionId: "NOT_SUBMITTED", label: "Нет, уведомление не подавали" }
    ]
  },
  {
    questionId: "Q_AD_MATERIAL_QUALIFICATION",
    text: "Отмеченные блоки являются рекламой в интернете, размещённой в интересах вашего бизнеса или другого лица?",
    explanation: "По внешнему виду страницы нельзя всегда достоверно определить, является ли блок рекламой.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "IS_INTERNET_AD", label: "Да, это реклама в интернете" },
      { optionId: "NOT_AD", label: "Нет, это собственная информация, каталог или навигация" }
    ]
  },
  {
    questionId: "Q_AUTH_OWNER_STATUS",
    text: "Владелец сайта — российская организация, индивидуальный предприниматель или гражданин России?",
    explanation: "Требования к способам входа применяются не ко всем владельцам сайтов.",
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
    text: "Какие способы входа доступны пользователям из России?",
    explanation: "Если требование применимо, важно понять, какие способы входа действительно доступны пользователю.",
    answerType: "MULTI_SELECT",
    required: true,
    allowUnknown: true,
    exclusiveOptionIds: ["NO_AUTH"],
    options: [
      { optionId: "NO_AUTH", label: "Вход на сайте не предусмотрен" },
      { optionId: "ESIA", label: "ЕСИА / Госуслуги" },
      { optionId: "ALLOWED_RU_METHOD", label: "Российский номер или иной разрешённый законом способ" },
      { optionId: "LOGIN_PASSWORD_ONLY", label: "Только имя пользователя и пароль" },
      { optionId: "FOREIGN_PROVIDERS_ONLY", label: "Только иностранные службы для входа" },
      { optionId: "OTHER", label: "Другое" }
    ]
  },
  {
    questionId: "Q_RECOMMENDER_TECH_USE",
    text: "Подбирает ли сайт товары, услуги или материалы под конкретного пользователя?",
    explanation: "По внешним признакам не всегда можно достоверно понять, используются ли рекомендательные технологии.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "USES_RECOMMENDER_TECH", label: "Да" },
      { optionId: "NO_RECOMMENDER_TECH", label: "Нет" },
      { optionId: "BASIC_SORTING_ONLY", label: "Только обычная сортировка или фильтры без персонального подбора" }
    ]
  },
  {
    questionId: "Q_LANGUAGE_EXCEPTION",
    text: "Почему этот фрагмент публичной информации оставлен только на иностранном языке?",
    explanation: "Нужно понять, относится ли этот фрагмент к законным исключениям из требования о русском языке.",
    answerType: "SINGLE_SELECT",
    required: true,
    allowUnknown: true,
    options: [
      { optionId: "TRADEMARK_OR_BRAND", label: "Это товарный знак или узнаваемое название" },
      { optionId: "LEGAL_NAME", label: "Это фирменное наименование" },
      { optionId: "PRODUCT_MODEL_NAME", label: "Это название товара или модели" },
      { optionId: "NOT_MANDATORY_CONSUMER_INFO", label: "Это не обязательная потребительская информация" },
      { optionId: "NO_EXCEPTION", label: "Исключения нет" }
    ]
  }
];

export const OWNER_QUESTION_BY_ID = new Map(OWNER_QUESTIONS.map((question) => [question.questionId, question]));
