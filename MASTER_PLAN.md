# MASTER_PLAN.md

## Compliance Platform для сайтов РФ — мастер-план продукта

**Версия:** 0.1  
**Дата:** 6 сентября 2026

## 1. Что строим

Российский SaaS-сервис, который по URL сайта:

1. исследует сайт технически;
2. определяет применимые требования;
3. фиксирует технические факты;
4. сохраняет доказательства;
5. применяет формализованные legal rules;
6. отделяет подтверждённую проблему от риска и неопределённости;
7. показывает конкретное исправление;
8. позже позволяет перепроверить сайт и постоянно следить за изменениями.

Цель — не создать ещё один «152-ФЗ-сканер», а постепенно построить Evidence-based Compliance OS для сайтов в России.

## 2. Финальная продуктовая цепочка

```text
SCAN
↓
CLASSIFY
↓
PROVE
↓
ASSESS
↓
ASK
↓
COMPARE
↓
REMEDIATE
↓
RESCAN
↓
MONITOR
↓
DOCUMENT
```

Расшифровка:

- **SCAN** — страницы, формы, документы, scripts, cookies, storage, network, iframes, реквизиты.
- **CLASSIFY** — тип сайта и применимые модули.
- **PROVE** — evidence: URL, DOM, screenshot, network, cookie/storage, document.
- **ASSESS** — Rule Engine → PASS / FAIL / WARNING / MANUAL_CHECK + confidence.
- **ASK** — вопросы владельцу о том, что нельзя доказать снаружи.
- **COMPARE** — документы против фактического поведения сайта.
- **REMEDIATE** — конкретное исправление.
- **RESCAN** — повторная проверка.
- **MONITOR** — отслеживание новых рисков.
- **DOCUMENT** — Compliance Passport и история состояния.

## 3. Ключевые отличия от конкурентов

### Evidence-first
Каждый значимый вывод связан с доказательством.

### Факт ≠ юридический вывод
Иностранный server/script/endpoint не становится автоматически доказанным нарушением.

### Несколько статусов
- PASS
- FAIL
- WARNING
- MANUAL_CHECK

### Confidence
Сервис показывает степень уверенности и ограничения вывода.

### Определение применимости
Сначала определяется тип сайта, потом включаются только релевантные правила.

### Owner Compliance
Позже сервис задаёт владельцу динамические вопросы о CRM, БД, рассылках, получателях данных и т. п.

### Document Reality Check
Сравнение политики/согласия/оферты с реальным сайтом.

### External Services Intelligence
Каталог внешних сервисов: provider, purpose, domains, data notes, jurisdiction notes, наличие в документах.

### Remediation вместо PDF
Продукт должен доводить клиента до исправленного состояния.

### Fix → Re-scan → Monitor
Ценность не заканчивается диагностикой.

### Versioned Legal Rulebase
Каждое правило имеет версию, источник, даты действия и дату последней проверки.

### Russia-only customer data plane
Production customer data, evidence и AI pipeline должны оставаться в российском контуре.

### B2B-ready
Позже можно добавить agency dashboard, API, white label и CI/CD, но не строить их заранее.

## 4. Архитектурные принципы

### Детерминированное ядро
LLM не отвечает на вопрос «нарушен ли закон?».

Правильная цепочка:

```text
FACT
↓
RULE
↓
APPLICABILITY
↓
FINDING
```

### LLM — только semantic layer
Допустимые задачи:
- извлечение структуры документов;
- классификация текста;
- сопоставление формулировок;
- подготовка объяснений.

### Минимизация ПД
Не хранить полные персональные значения без необходимости.

### Customer Data Never Leaves Russia
Production backend, DB, evidence, logs, browser workers и AI processing — российский контур.

### GitHub/Codex
Только:
- source code;
- docs;
- synthetic test data.

Не использовать для:
- production dumps;
- customer screenshots;
- production HTML/logs с ПД.

### Безопасный scanner
Нужны:
- private IP blocking;
- redirect validation;
- DNS rebinding protection;
- rate limits;
- timeouts;
- page limits;
- browser isolation.

### Никаких необратимых действий
Crawler/Playwright не отправляет формы, не делает покупки и не совершает опасных действий.

### Правило знает свои ограничения
Если факт нельзя установить автоматически — WARNING или MANUAL_CHECK, не FAIL.

## 5. Техническое направление

Базовый стек:

- Next.js + TypeScript;
- PostgreSQL в РФ;
- Playwright;
- простой background job mechanism;
- object storage — при реальной необходимости;
- versioned rules в JSON/YAML или БД;
- российский AI API / self-hosted model, когда AI станет нужен;
- PII sanitizer перед AI.

Главный принцип: **не строить микросервисы и enterprise-инфраструктуру без необходимости**.

## 6. Этапы разработки

### Этап 0. Продуктовая и правовая рамка
**Результат:**
- PRD MVP;
- data model;
- Legal Rulebase v0.1 минимум 50 правил;
- External Services Catalog v0.1;
- acceptance tests / golden dataset.

**Критерий выхода:** по каждому rule ясно, когда он применим, какие facts/evidence нужны и когда обязателен MANUAL_CHECK.

### Этап 1. Российская инфраструктура и безопасный data plane
**Результат:**
- staging/production foundation в РФ;
- безопасный URL entrypoint;
- data-flow схема продукта;
- security baseline.

**Критерий выхода:** customer data остаются в РФ, scanner не имеет доступа к private/internal network.

### Этап 2. Crawler + Browser Audit + Evidence Engine
**Результат:**
- Scan JSON;
- Facts;
- Evidence;
- external service detection;
- PII minimization.

**Критерий выхода:** scanner стабильно работает минимум на 20 тестовых сайтах и evidence подтверждает факты.

### Этап 3. Rule Engine и 40–50 рабочих checks
**Результат:**
- детерминированный Rule Engine;
- site classification;
- findings;
- status/severity/confidence;
- remediation.

**Критерий выхода:** ≥90% совпадения с golden dataset, критические false positives отсутствуют.

### Этап 4. MVP UI + closed beta
**Результат:**
- URL → scan → findings → remediation;
- кабинет;
- External Services view;
- 10–30 beta-пользователей.

**Критерий выхода:** ≥80% пользователей понимают главные проблемы и следующие действия без сопровождения.

### Этап 5. Commercial Beta
Добавляем только после успешной MVP beta:
- Owner Questionnaire;
- document parser;
- Document Reality Check;
- re-scan/diff;
- payment;
- basic scan history;
- Fix lead.

### Этап 6. V1
- Monitoring;
- Compliance Passport;
- expanded External Services;
- rule version re-evaluation;
- basic Data Flow View.

### Этап 7. Remediation Layer
- CMS instructions;
- coding tasks;
- first semi-automatic fixes;
- first industry vertical.

### Этап 8. Scale
Только после подтверждённого спроса:
- agency dashboard;
- white label;
- API;
- CI/CD;
- GitHub integration;
- lawyer workspace;
- partner model.

## 7. Сквозное тестирование

### Synthetic fixtures
Специальные страницы с заранее известным состоянием.

### Golden dataset
Эталонные PASS / FAIL / WARNING / MANUAL_CHECK.

### Real websites
Постоянная выборка сайтов разных CMS и типов.

### False-positive review
Ошибочный critical FAIL опаснее пропущенного low-severity warning.

### Document benchmark
Появится перед AI document analysis.

### Browser-state tests
До взаимодействия, после consent accept/reject — когда безопасно.

### Security tests
SSRF, redirects, private IP, huge pages, infinite redirects, JS errors, timeout, browser crash.

### UX comprehension
Пользователь должен понимать finding и следующий шаг.

### Rule regression
Изменение rule не должно ломать старые кейсы.

### Expert review
Перед коммерческим запуском критических rules — юридическое ревью.

## 8. Монетизация — не для MVP-кода, но для продуктового направления

Потенциальная лестница:

- Free — score + несколько findings;
- Audit — полный evidence-based audit;
- Compliance Pack — audit + документы/owner assessment;
- Fix — исправление под ключ;
- Monitor — recurring;
- Business — несколько сайтов;
- Agency — portfolio/white label/API;
- Expert Review — сложные случаи.

Первая версия должна доказать ценность аудита. Не строить billing до стабильного core.

## 9. Главные метрики качества

- критические false positives → стремиться к нулю;
- 40–50 качественных rules на MVP;
- 100% FAIL/WARNING имеют evidence или явный missing context;
- первый полезный результат — минуты, не часы;
- ≥80% beta-пользователей понимают результат;
- re-scan в будущем должен подтверждать закрытие finding;
- monitoring должен иметь низкий noise rate.

## 10. Основные риски

### Legal false positives
Снижение: fact → rule → applicability → finding.

### Устаревшие нормы
Снижение: versioned rules + official source + effective dates.

### LLM hallucinations
Снижение: LLM не присваивает финальный юридический статус.

### Собственный non-compliance
Снижение: российский data plane и PII minimization.

### SSRF
Снижение: network isolation, private IP blocking, redirect checks, rate limits.

### Scope explosion
Снижение: новый закон/отрасль только отдельным модулем после стабильного core.

### Commodity pressure
Не конкурировать PDF-отчётом. Основная ценность — evidence, context, remediation, re-scan и monitoring.

## 11. Что нельзя потерять

1. Не превращать foreign server/script в автоматическое доказательство трансграничного нарушения.
2. Не строить юридический вывод целиком на LLM.
3. Не выпускать rule без условий применимости и evidence requirements.
4. Не увеличивать число checks ценой сомнительных выводов.
5. Не отправлять production customer data в иностранные developer tools.
6. Не делать PDF главным продуктом.
7. Не строить отраслевые модули до стабильного core.
8. Не автоматизировать fixes до появления повторяемых кейсов.
9. Не обещать юридическую гарантию там, где есть автоматическая оценка.
10. Перед коммерческим запуском провести экспертное ревью критических legal rules.

## 12. Принцип простоты и расширяемости

Перед любым новым архитектурным решением задаются вопросы:

1. Нужна ли вещь текущей версии?
2. Предотвращает ли её отсутствие дорогую переделку ядра позже?
3. Можно ли получить тот же результат проще?

Правило:

- нужно сейчас → делаем;
- не нужно сейчас, но это фундамент для расширения → закладываем минимальный контракт;
- не нужно и не предотвращает переделку → не делаем.

Неизменяемое ядро:

```text
Website
→ Scan
→ Facts + Evidence
→ Rule Engine
→ Findings
```

Всё остальное должно подключаться к этому ядру, а не заменять его.
