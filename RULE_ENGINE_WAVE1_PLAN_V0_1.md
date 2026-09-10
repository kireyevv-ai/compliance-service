# RULE_ENGINE_WAVE1_PLAN_V0_1.md

## Первая runtime-волна

После стабильных Task 003–006 в Rule Engine первой включается только небольшая deterministic группа:

- `PD-001`
- `PD-002`
- `PD-003`
- `EC-001`
- `EC-002`
- `EC-003`
- `EC-004`
- `EC-005`
- `EC-006`
- `EC-007`
- `EC-008`
- `EC-009`
- `EC-013`
- `CON-001`
- `CON-002`

Всего: **15 правил**.

## Почему именно эти правила

Они:
- опираются на static HTML / HTTP / простую applicability;
- не требуют LLM;
- не требуют owner questionnaire;
- не требуют квалификации интернет-рекламы;
- не требуют определения трансграничной передачи;
- дают понятное Evidence.

## Что НЕ входит в Wave 1

Не активировать пока:
- semantic policy rules;
- cross-border/localization conclusions;
- advertising qualification;
- recommender-technology qualification;
- RKN/FNS lookups;
- rules, требующие Owner Context.

## Отдельная оговорка

`CON-001` и `CON-002` остаются `WARNING`, а не `FAIL`.

`PD-001`–`PD-003` должны учитывать scan coverage: неполный crawl не может автоматически превращаться в доказанное отсутствие policy.
