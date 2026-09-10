# CODEX_TASK_001.md

## Задача 001 — архитектурный draft MVP

Перед началом:
1. Прочитай `docs/MASTER_PLAN.md`.
2. Прочитай `docs/PRD_MVP.md`.
3. Не пытайся реализовать весь продукт.
4. Не создавай архитектуру «на будущее», если она не требуется PRD.
5. Не упрощай неизменяемое ядро: `Website → Scan → Facts + Evidence → Rule Engine → Findings`.

## Цель

Предложить минимально достаточную техническую архитектуру MVP, которая:
- проста в реализации;
- не содержит ненужных abstractions;
- позволяет добавить будущие функции без переписывания центрального ядра;
- рассчитана на российский production data plane.

## Постоянные ограничения

### 1. LLM не является юридическим Rule Engine
Запрещено: `HTML → LLM → violations`.

Обязательно: `Website → Scan → Facts + Evidence → Rule Engine → Findings`.

### 2. Каждый Scan — отдельный снимок
Не перезаписывать предыдущие результаты.

### 3. Finding использует статусы
`PASS`, `FAIL`, `WARNING`, `MANUAL_CHECK`.

Не заменять boolean-полем.

### 4. Rule version сохраняется вместе с Finding
Это необходимо для будущего изменения законодательства.

### 5. Evidence — отдельный объект
Не хранить доказательства только произвольным текстом внутри Finding.

### 6. Не создавать микросервисную архитектуру
На MVP предпочтителен один Next.js/TypeScript application плюс отдельный Playwright worker только если это технически оправдано.

### 7. Не реализовывать следующие этапы
Не делать сейчас:
- Owner Questionnaire;
- document AI;
- monitoring;
- payments;
- agency dashboard;
- API;
- white label;
- auto-fix;
- CI/CD;
- отраслевые модули.

Разрешается только проверить, что архитектура не блокирует их добавление.

### 8. Production data
Архитектура должна быть рассчитана на российскую инфраструктуру. GitHub/Codex — только code, docs и synthetic test data.

## Задание

Создай `docs/ARCHITECTURE_DRAFT.md`.

Документ должен содержать:

### A. Структура проекта
Минимальная структура директорий для:
- UI;
- scanner;
- Playwright audit;
- facts;
- evidence;
- rule engine;
- findings;
- database;
- tests;
- legal rules;
- external services catalog.

Не добавлять директории для функций, которых нет в MVP.

### B. Data model
Предложи минимальную PostgreSQL schema для:
- User;
- Site;
- Scan;
- Fact;
- Evidence;
- Finding.

Отдельно сравни для MVP:
- Rule/RuleVersion в PostgreSQL;
- versioned JSON/YAML в repository.

Выбери более простой вариант, если он не создаёт дорогой миграции позже.

То же самое сделай для ExternalService.

### C. Scan lifecycle
Предложи минимальные состояния, например:
`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`.

Не усложняй state machine.

### D. Background jobs
Предложи самый простой надёжный механизм scan jobs.

Не добавляй Redis только потому, что это распространённый паттерн. Если PostgreSQL queue достаточна — предложи её и объясни trade-off.

### E. Evidence storage
Определи:
- что хранить в PostgreSQL;
- что в object storage;
- можно ли object storage отложить на MVP.

### F. Rule Engine contract
Опиши TypeScript interfaces для:
- Fact;
- Rule;
- RuleEvaluation;
- Finding;
- Evidence.

Не реализовывай legal rules. Нужен только контракт.

### G. Extensibility check
Коротко покажи, как без переписывания ядра позже добавятся:
- Owner Questionnaire;
- Document Reality Check;
- re-scan / Monitoring;
- Compliance Passport;
- CMS remediation.

Не реализовывай эти функции.

### H. Security baseline
Минимальная архитектура SSRF protection:
- private IP blocking;
- redirect validation;
- DNS rebinding protection;
- timeout;
- page limits;
- network isolation.

### I. Testing foundation
Предложи структуру:
- synthetic fixtures;
- golden dataset;
- scanner tests;
- rule engine tests;
- security tests.

## Что НЕ делать

На этом задании:
- не писать application code;
- не создавать database migrations;
- не устанавливать зависимости;
- не создавать Docker infrastructure;
- не менять существующие файлы приложения;
- не придумывать legal rules;
- не проектировать UI;
- не добавлять новые продуктовые функции.

## Критерии качества

Архитектура подходит, если:

1. цепочка `Scan → Facts/Evidence → Rules → Findings` не требует изменения при добавлении следующих этапов;
2. нет инфраструктуры, которая не нужна MVP;
3. нет сущностей «на всякий случай»;
4. будущий re-scan возможен за счёт нескольких Scan у одного Site;
5. будущий monitoring не требует менять Scan;
6. будущие owner answers могут добавлять context/facts без переписывания Rule Engine;
7. новые legal rules добавляются без изменения scanner;
8. новые типы evidence добавляются без изменения Finding;
9. архитектура понятна одному разработчику;
10. проект запускается без Kubernetes, микросервисов и enterprise-инфраструктуры.

## Финальное действие

После создания `docs/ARCHITECTURE_DRAFT.md` остановись.

Не начинай писать код.

В конце документа добавь:

`## Decisions requiring product owner approval`

Туда вынеси только решения, где реально есть несколько существенно разных вариантов.

Не задавай вопросы, ответы на которые уже есть в `MASTER_PLAN.md` или `PRD_MVP.md`.
