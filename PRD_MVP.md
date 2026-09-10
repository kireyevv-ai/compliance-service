# PRD_MVP.md

## Compliance Platform для сайтов РФ — MVP Product Requirements Document

**Версия:** 0.1  
**Дата:** 6 сентября 2026  
**Статус:** рабочий документ для начала разработки

## 1. Цель MVP

Создать рабочий сервис, в котором владелец российского коммерческого сайта:

1. вводит URL;
2. сервис технически исследует сайт;
3. определяет факты, имеющие значение для compliance;
4. применяет формализованные правила;
5. показывает подтверждённые проблемы, потенциальные риски и случаи, которые нельзя установить автоматически;
6. показывает доказательства;
7. объясняет, что именно нужно исправить.

MVP не является автоматической юридической гарантией соответствия законодательству.

Главное обещание:

> Вставьте адрес сайта — получите доказательный разбор: что обнаружено, почему это важно, насколько вывод достоверен и что конкретно нужно изменить.

## 2. Главный продуктовый принцип

Сервис не должен пытаться находить максимальное количество «нарушений». Он должен давать максимально доказуемые и воспроизводимые выводы.

При недостатке информации система обязана использовать:
- `WARNING` — обнаружен риск или косвенный признак;
- `MANUAL_CHECK` — автоматического анализа недостаточно.

Нельзя превращать предположение в `FAIL`.

Пример:

**Неправильно:** «Обнаружен иностранный сервер. Нарушена локализация ПД».

**Правильно:** «Обнаружен внешний endpoint / инфраструктурный признак за пределами РФ. Это само по себе не подтверждает нарушение требований локализации. Необходимо установить, где выполняется первичная обработка и где находится база данных».

## 3. Неизменяемое архитектурное ядро

Будущие функции должны добавляться поверх цепочки:

```text
WEBSITE
   ↓
SCAN
   ↓
FACTS + EVIDENCE
   ↓
RULE ENGINE
   ↓
FINDINGS
```

Эту модель нельзя заменять схемой `HTML → LLM → "нарушения"`.

### 3.1. Минимальные сущности

**User** — пользователь продукта.

**Site**
- id
- user_id
- url
- normalized_domain
- created_at

**Scan** — отдельный снимок состояния сайта.
- id
- site_id
- status
- started_at
- finished_at
- scanner_version
- created_at

Каждый новый запуск создаёт новый Scan. Старые результаты не перезаписываются. Это фундамент для re-scan, diff, monitoring и Compliance Passport.

**Fact** — нормализованный технический факт:
- id
- scan_id
- page_url
- fact_type
- value_json
- created_at

Примеры fact_type:
- `form_found`
- `personal_data_field_found`
- `policy_link_found`
- `checkbox_found`
- `checkbox_prechecked`
- `cookie_set`
- `external_request_found`
- `script_found`
- `iframe_found`
- `seller_requisite_found`

**Evidence** — доказательство факта:
- id
- scan_id
- fact_id
- evidence_type
- page_url
- payload / storage_ref
- created_at

Типы evidence:
- DOM/text fragment;
- screenshot;
- network request;
- cookie/storage event;
- document reference.

**Rule** — формализованное правило. На MVP может храниться в versioned JSON/YAML, если это проще БД.

Обязательные поля:
- rule_id
- version
- title
- module
- applies_to
- required_facts
- legal_basis
- severity
- evaluation
- remediation
- confidence_policy
- limitations
- effective_from
- effective_to
- last_verified_at

**Finding**
- id
- scan_id
- rule_id
- rule_version
- status
- severity
- confidence
- summary
- explanation
- remediation
- created_at

Статусы:
- `PASS`
- `FAIL`
- `WARNING`
- `MANUAL_CHECK`

**ExternalService** — каталог известных внешних сервисов:
- service_id
- name
- domains
- category
- provider
- jurisdiction_notes
- data_notes

## 4. Что должно быть расширяемым с первого дня

Будущие функции не реализуем заранее, но текущая модель не должна мешать их добавлению.

### Owner Questionnaire
Пока не строим анкету. Rule/Finding должны уметь хранить `missing_context`, например:
- crm_provider
- database_location
- mailing_usage

Позже это станет основанием для динамических вопросов.

### Document Reality Check
Пока не строим AI-анализ документов. Scanner должен уметь находить URL policy/consent/offer и связывать найденный документ со Scan.

### Re-scan и Monitoring
Обеспечиваются моделью `Site → Scan #1 → Scan #2 → Scan #3`. Отдельной архитектуры сейчас не требуется.

### Site classification
В MVP:
- `B2B`
- `B2C_SERVICE`
- `ECOMMERCE`
- `OTHER`

Позже можно добавить `SAAS`, `MEDICAL`, `EDUCATION`, `FINANCE` и другие категории. Правила содержат `applies_to`.

### Remediation
В MVP — текстовая рекомендация. Структура позже может получить CMS-specific instruction, coding task и auto-fix без изменения Rule Engine.

## 5. Что входит в MVP

### 5.1. Пользовательский сценарий

1. Пользователь вводит URL.
2. Система нормализует и безопасно проверяет URL.
3. Создаются Site и Scan.
4. Scanner исследует главную и до 20–30 внутренних страниц.
5. Browser audit собирает rendered DOM, cookies/storage, network requests, scripts, iframes.
6. Scanner создаёт Facts и Evidence.
7. Система определяет тип сайта, пользователь может подтвердить/изменить его.
8. Rule Engine применяет правила.
9. Пользователь получает Findings и конкретные remediation.

### 5.2. Что исследуем

- формы;
- поля форм;
- checkbox;
- ссылки;
- юридические документы;
- scripts;
- iframes;
- cookies;
- localStorage/sessionStorage;
- network requests;
- базовые реквизиты;
- внешние сервисы.

## 6. Scope законодательства MVP

Первая версия не проверяет всё российское законодательство.

### Core Personal Data
- формы сбора ПД;
- наличие политики;
- доступность политики;
- отдельность согласия;
- prechecked checkbox;
- набор собираемых полей;
- cookies / analytics / external scripts;
- базовые сведения об операторе;
- потенциальные внешние получатели / data flows;
- случаи, требующие owner clarification.

### B2C / e-commerce
- сведения о продавце;
- наименование / ФИО;
- ОГРН / ОГРНИП;
- контактная информация;
- оферта;
- базовые сведения дистанционной продажи;
- предустановленные согласия на дополнительные платные услуги.

### Public information / advertising
Только очевидные и хорошо формализуемые проверки. Спорные сценарии получают `WARNING` или `MANUAL_CHECK`.

## 7. Legal Rulebase v0.1

Цель этапа 0 — минимум 50 формализованных правил.

Шаблон:

```yaml
rule_id:
version:
title:
module:
applies_to:
required_facts:
evaluation:
legal_basis:
severity:
confidence_policy:
remediation:
limitations:
effective_from:
effective_to:
last_verified_at:
```

Запрещены правила вида: «отправить страницу в LLM и спросить, нарушает ли она закон».

LLM может использоваться только как semantic extraction layer, а не как финальный юридический арбитр.

## 8. Evidence-first

Каждый `FAIL` должен иметь evidence.

Каждый `WARNING` должен иметь evidence либо явное объяснение, что технический факт найден, но юридического контекста недостаточно.

Обязательные типы evidence на MVP:
1. page URL;
2. DOM/text fragment;
3. network event;
4. cookie/storage event;
5. screenshot — только когда он реально повышает понятность.

Не делать screenshot каждой страницы.

## 9. Browser audit

Использовать Playwright.

Минимальный сбор:
- rendered DOM;
- cookies;
- localStorage;
- sessionStorage;
- network requests;
- scripts;
- iframes.

Crawler не должен:
- отправлять формы;
- покупать товары;
- подтверждать подписки;
- нажимать опасные кнопки;
- выполнять необратимые действия.

## 10. Безопасность scanner

До публичного использования обязательно:
- block localhost;
- block private IP ranges;
- block link-local / metadata endpoints;
- проверка redirect destinations;
- защита от DNS rebinding;
- timeout;
- page-size limits;
- crawl limits;
- rate limits;
- изоляция browser worker.

## 11. Russia-only production data plane

В российском контуре должны находиться:
- production application;
- PostgreSQL;
- screenshots/evidence;
- scan data;
- browser workers;
- production logs;
- AI pipeline, если он получает клиентский контент.

GitHub/Codex:
- source code;
- documentation;
- synthetic fixtures.

Не передавать туда:
- production DB dumps;
- реальные screenshots клиентов;
- production logs с ПД;
- HTML snapshots клиентов с ПД.

## 12. PII minimization

Не сохранять полные персональные значения, если они не нужны для evidence.

Пример: вместо полного e-mail можно хранить `EMAIL_FOUND=true` и маску `i***@example.ru`.

Аналогично с телефонами, ФИО и другими персональными значениями.

## 13. External Services v0.1

На старте каталог 30–50 массовых сервисов.

Категории:
- analytics;
- tag managers;
- captcha;
- CRM;
- chat/callback;
- advertising pixels;
- video;
- maps;
- CDN/widgets.

Цель: не объявлять автоматически трансграничное нарушение, а показать:
- какой сервис обнаружен;
- каким способом;
- provider;
- потенциальную роль;
- требуется ли дополнительная проверка.

## 14. UI MVP

### Главная
URL + кнопка «Проверить».

### Экран процесса
Показывает понятные стадии без технического шума.

### Результат
Например:
- 4 подтверждённые проблемы;
- 7 потенциальных рисков;
- 3 пункта требуют уточнения;
- 21 проверка пройдена.

Score может быть только навигационным показателем, не юридической гарантией.

### Finding card
- статус;
- название;
- страница;
- факт;
- evidence;
- норма;
- confidence;
- remediation.

### External Services
Простая таблица найденных сервисов.

## 15. Что сознательно НЕ входит в MVP

Не реализуем сейчас:
- оплату;
- PDF;
- monitoring;
- re-scan diff UI;
- Owner Questionnaire;
- полноценный AI document parser;
- Document Reality Check;
- CMS instructions;
- auto-fix;
- GitHub integration;
- agency dashboard;
- white label;
- API;
- CI/CD;
- lawyer workspace;
- отраслевые модули;
- сложный Data Flow Map;
- market benchmarks;
- собственную LLM;
- микросервисы;
- Kubernetes.

## 16. Технический принцип MVP

Предпочтительная стартовая схема:

```text
ONE APPLICATION
Next.js + TypeScript
        │
        ├── web UI
        ├── scan orchestration
        ├── rule engine
        ├── findings
        └── DB access

PostgreSQL
Playwright worker
Object storage — только если реально нужен
```

Не делить продукт на микросервисы без необходимости. Redis не обязателен, если очередь можно надёжно реализовать проще.

## 17. Тестирование MVP

### Synthetic fixtures
Создать тестовые страницы:
- форма без policy;
- форма с policy;
- prechecked checkbox;
- unchecked checkbox;
- cookie до consent;
- external script;
- iframe;
- dynamic rendered form;
- e-commerce seller details;
- отсутствие реквизитов.

### Golden dataset
Для каждого rule — PASS, FAIL и при необходимости WARNING/MANUAL_CHECK.

### Реальные сайты
Минимум 20:
- 5 B2B;
- 5 B2C services;
- 5 e-commerce;
- 5 mixed/custom.

CMS/стек:
- Tilda;
- WordPress;
- Bitrix;
- custom;
- React/Next.

### Security
Обязательные тесты:
- localhost;
- 127.0.0.1;
- private ranges;
- metadata endpoints;
- redirect to private IP;
- huge page;
- infinite redirects;
- timeout;
- broken JavaScript.

### UX
Пользователь без объяснений должен назвать:
1. три главные проблемы;
2. где они находятся;
3. что делать дальше.

## 18. Definition of Done MVP

MVP готов к closed beta, когда:

1. пользователь вводит URL;
2. scanner безопасно исследует сайт;
3. создаются нормализованные Facts;
4. Evidence подтверждает факты;
5. Rule Engine выполняет 40–50 core checks;
6. результат различает PASS / FAIL / WARNING / MANUAL_CHECK;
7. foreign script/server не становится автоматически доказанным нарушением;
8. каждый FAIL имеет evidence;
9. пользователь получает конкретную remediation;
10. scanner протестирован минимум на 20 реальных сайтах;
11. golden dataset даёт ≥90% совпадения с эталонными статусами;
12. критические false positives отсутствуют;
13. production architecture рассчитана на российский data plane;
14. продукт не выполняет необратимых действий на проверяемом сайте.

## 19. Критерий архитектурного решения

Перед добавлением любой сущности, сервиса, библиотеки или инфраструктурного компонента задаём три вопроса:

1. Нужен ли он текущей версии?
2. Предотвращает ли его отсутствие дорогую переделку ядра позже?
3. Можно ли получить тот же результат проще?

Правило:
- нужен сейчас → реализовать;
- не нужен сейчас, но отсутствие ломает расширяемость → заложить минимальный контракт;
- не нужен и не предотвращает будущую переделку → не делать.

## 20. Следующий этап после MVP

После successful closed beta:
1. Owner Questionnaire;
2. document parsing;
3. Document Reality Check;
4. re-scan + diff;
5. payment;
6. Monitoring;
7. Compliance Passport;
8. CMS remediation;
9. первый отраслевой модуль.

Порядок может меняться только по данным реального использования.
