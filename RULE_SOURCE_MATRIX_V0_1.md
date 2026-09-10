# RULE_SOURCE_MATRIX_V0_1.md

## Назначение

Матрица определяет **не юридическую силу правил**, а технические источники фактов, которые нужны Rule Engine.

Главная цель — не заставлять scanner собирать данные «на всякий случай».

### Источники

- `H` — Basic Crawler + static HTML Fact Extraction.
- `B` — Playwright: rendered DOM, browser state, cookies/storage/network.
- `D` — semantic/document analysis: policy, consent, offer, тексты и сопоставление содержания.
- `S` — External Services Catalog + attribution домена/script/network к сервису.
- `O` — Owner Context: сведения, которых нет в публичной части сайта.
- `X` — внешний официальный реестр/API.
- `C` — применимость/классификация: тип сайта, seller kind, подтверждение специальных сценариев.

### Этапы

- `T4` — HTML Fact Extraction после Task 003.
- `T5` — Playwright Browser Audit.
- `T6` — External Services Detection.
- `T_doc` — Document/Semantic Analysis.
- `T_owner` — Owner Questionnaire/Context.
- `T_lookup` — внешние реестры.
- `T_later` — не активировать в первой волне, пока нет надёжной квалификации.

## Матрица

| Rule | Sources | Earliest | Нужные данные | Режим | Комментарий |
|---|---|---|---|---|---|
| `PD-001` | `H` | `T4` | form/personal-data fields + policy link/search | `AUTO` | Basic HTML can support a reliable first version. |
| `PD-002` | `H` | `T4` | policy link + HTTP accessibility | `AUTO` | Basic crawler already fetches linked HTML URLs; document links can be checked by status without parsing. |
| `PD-003` | `H` | `T4` | form + nearby/global policy link | `AUTO` | Static DOM is enough for the first version. |
| `PD-004` | `H+B` | `T5` | policy URL + auth/blocked browser state | `AUTO` | HTTP 401/403/redirect can be caught earlier, but browser state is needed for reliable FAIL. |
| `PD-005` | `H+B` | `T5` | consent control + associated text/links | `AUTO` | Static HTML may be enough, but rendered state is safer. |
| `PD-006` | `H+B` | `T5` | PD consent control + actual checked state | `AUTO` | JS can change initial state; Playwright is authoritative. |
| `PD-007` | `H+B+O` | `T5/T_owner` | PD collection + absence of consent mechanism + unknown alternative basis | `MANUAL` | Can create MANUAL_CHECK after browser audit; owner context later resolves it. |
| `PD-008` | `H+D` | `T_doc` | consent text + semantic purpose extraction | `SEMANTIC` | Do not add brittle keyword logic just to activate this early. |
| `PD-009` | `H+D` | `T_doc` | consent text + blanket-scope semantic detection | `SEMANTIC` | Could be regexed, but semantic layer reduces false positives. |
| `PD-010` | `H+B` | `T5` | service form + marketing consent association | `AUTO` | Needs structure/association; rendered DOM improves reliability. |
| `PD-011` | `H+B` | `T5` | marketing consent + actual checked state | `AUTO` | Browser state should decide prechecked. |
| `PD-012` | `H+O` | `T_owner` | marketing intent + proof mechanism unknown | `MANUAL` | Website can show intent; owner must explain how consent proof is stored. |
| `PD-013` | `D` | `T_doc` | policy purposes | `SEMANTIC` | Document analysis. |
| `PD-014` | `D` | `T_doc` | policy data categories | `SEMANTIC` | Document analysis. |
| `PD-015` | `D` | `T_doc` | retention/deletion provisions | `SEMANTIC` | Document analysis. |
| `PD-016` | `D` | `T_doc` | data-subject request procedure | `SEMANTIC` | Document analysis. |
| `PD-017` | `H+B+D` | `T_doc` | actual form fields vs policy-described fields | `SEMANTIC` | Cross-check requires both scan facts and parsed policy. |
| `PD-018` | `B+S+D` | `T_doc` | detected service vs policy mentions | `SEMANTIC` | Requires external-service detection plus policy parsing. |
| `PD-019` | `B+S+D` | `T_doc` | policy 'no third parties' claim + third-party services | `SEMANTIC` | Document reality check. |
| `PD-020` | `H+B+S` | `T6` | PD collection + foreign service/endpoint | `MANUAL` | Produces MANUAL_CHECK, never automatic cross-border FAIL. |
| `PD-021` | `H+B+S` | `T6` | form action/JS endpoint + foreign-domain attribution | `RISK` | Static form action may be available in T4; JS configs/network require later stages. |
| `PD-022` | `H+B+O` | `T_owner` | PD collection + DB location unknown | `MANUAL` | Owner answer is required; web-server geography is not enough. |
| `PD-023` | `H+B+X` | `T_lookup` | operator identity + automated processing + RKN registry lookup | `RISK` | External registry integration; identity match must be confident. |
| `PD-024` | `H+B+D` | `T_doc` | special-category-like fields/context | `MANUAL` | Field names may be easy, context can be semantic; keep MANUAL_CHECK. |
| `EC-001` | `H+C` | `T4` | e-commerce classification + remote-sale signals + offer link | `AUTO` | Static site structure is enough for first version. |
| `EC-002` | `H` | `T4` | offer link + HTTP accessibility | `AUTO` | Basic crawler can support. |
| `EC-003` | `H+C` | `T4` | seller kind + legal name | `AUTO` | Static text extraction. |
| `EC-004` | `H+C` | `T4` | seller kind + OGRN | `AUTO` | Pattern extraction. |
| `EC-005` | `H+C` | `T4` | seller kind + address | `AUTO` | Static text extraction; keep evidence snippet. |
| `EC-006` | `H+C` | `T4` | seller kind + email/phone | `AUTO` | Static text extraction. |
| `EC-007` | `H+C` | `T4` | IP seller kind + FIO | `AUTO` | Static text extraction; seller-kind classification required. |
| `EC-008` | `H+C` | `T4` | IP seller kind + OGRNIP | `AUTO` | Pattern extraction. |
| `EC-009` | `H+C` | `T4` | IP seller kind + email/phone | `AUTO` | Static text extraction. |
| `EC-010` | `H+D` | `T_doc` | complaint-submission information | `SEMANTIC` | Can be partially found in HTML, but offer/returns text may require document analysis. |
| `EC-011` | `B` | `T5` | paid add-on + actual selected state + price | `AUTO` | Checkout state is browser-dependent. |
| `EC-012` | `B+D` | `T_doc` | paid add-on + dependency/mandatory purchase logic | `SEMANTIC` | Do not simulate purchases; infer only from safe UI/terms evidence. |
| `EC-013` | `H` | `T4` | consumer price + RUB marker | `AUTO` | Static extraction is sufficient for many sites. |
| `ADV-001` | `B+D+C` | `T_later` | confirmed ad + label presence | `SEMANTIC` | Ad qualification is legally sensitive; do not activate early on heuristics. |
| `ADV-002` | `B+D+C` | `T_later` | confirmed ad + advertiser identity/link | `SEMANTIC` | Same qualification issue as ADV-001. |
| `ADV-003` | `B+D+C+O` | `T_later` | confirmed ad + ERID + applicability context | `MANUAL` | Applicability needs legal/context review. |
| `ADV-004` | `H+O` | `T_owner` | marketing subscription + consent-proof mechanism | `MANUAL` | Site shows subscription, owner explains proof storage. |
| `AUTH-001` | `H+B+C+O` | `T_owner` | Russian owner + auth required + auth providers | `MANUAL` | Owner/applicability context required. |
| `REC-001` | `H+B+S+D` | `T_later` | recommender signals + notice | `MANUAL` | First prove/suspect recommendation tech; avoid simplistic detection. |
| `REC-002` | `H+B+C+O` | `T_owner` | confirmed recommender tech + rules doc link | `AUTO_AFTER_CONTEXT` | FAIL only after applicability is confirmed. |
| `REC-003` | `H+B+D` | `T_doc` | rules doc + access + Russian-language text | `AUTO` | Document/browser analysis. |
| `REC-004` | `H+C+O` | `T_owner` | confirmed recommender tech + owner/contact info | `AUTO_AFTER_CONTEXT` | Applicability confirmation required. |
| `CON-001` | `H+C` | `T4` | B2C classification + legal-entity seller + name/address/hours | `RISK` | Static extraction; keep WARNING because off-site disclosure may exist. |
| `CON-002` | `H+C` | `T4` | B2C classification + IP + registration info | `RISK` | Static extraction; keep WARNING. |
| `LANG-001` | `H+D+C` | `T_doc` | mandatory consumer-information block + language | `SEMANTIC` | Need to classify the text as mandatory consumer information. |
| `LANG-002` | `H+D+C+O` | `T_later` | foreign-only consumer info + exception context | `RISK` | Trademark/firm-name exceptions make early automation risky. |

## Что это означает для разработки

### Первая волна: Task 004

Task 004 должен извлекать **только статические HTML facts**, которые нужны правилам с `T4` и являются базой для следующих этапов.

Не надо на Task 004:
- определять трансграничную передачу;
- квалифицировать интернет-рекламу;
- анализировать содержание политики целиком;
- определять место БД;
- строить Data Flow Map;
- использовать LLM.

### Вторая волна: Task 005

Playwright добавляет только то, чего нельзя надёжно получить из raw HTML:
- фактическое состояние checkbox/control;
- динамически отрисованные формы;
- browser-only DOM;
- cookies/storage/network;
- JS-configured endpoints;
- auth/UI state.

### Третья волна: Task 006

External-service attribution строится поверх уже собранных scripts/iframes/network domains и versioned catalog.

### Правила не обязаны активироваться одновременно

Rulebase может содержать 50 правил, а product runtime сначала активирует только те, для которых scanner умеет получить достаточные Facts/Evidence. Остальные остаются выключенными до соответствующего слоя.
