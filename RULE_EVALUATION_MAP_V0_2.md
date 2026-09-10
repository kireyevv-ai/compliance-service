# RULE_EVALUATION_MAP_V0_2

## Purpose

Stage 2 direction is LLM Semantic Reviewer.

This map classifies all 50 legal rules by the evaluator layer that should own the next meaningful implementation step:

- `DETERMINISTIC` - current deterministic facts are enough, or the missing piece is a narrow deterministic fact/evaluator.
- `LLM_SEMANTIC` - rule needs semantic extraction/classification from policy, consent text, offer, UI text, or page content. LLM may produce structured facts, not final legal conclusions.
- `OWNER_MANUAL` - public scan cannot establish the required business/legal context; evaluator should return `MANUAL_CHECK` or wait for owner-provided context.

`Can activate now` means the rule can be enabled in runtime without broad crawler/browser expansion and without turning assumptions into `FAIL`.

## Current Baseline

- Stage 1 deterministic core acceptance: PASS.
- Runtime active wave: 15 rules (`PD-001`, `PD-002`, `PD-003`, `EC-001`-`EC-009`, `EC-013`, `CON-001`, `CON-002`).
- Test suite after flaky stabilization: `npm.cmd test` PASS, 13 files / 117 tests; `npm.cmd run typecheck` PASS.
- Flaky fix made: test-only timeout increase for the largest browser-audit scenario in `tests/scanner/browser-audit.test.ts`; production scan limits unchanged.

## Rule Map

| Rule | Layer | Evidence needed | Evidence already present? | Evaluator verdicts | `MANUAL_CHECK` trigger | Can activate now? | Minimal gap |
|---|---|---|---|---|---|---|---|
| `PD-001` | `DETERMINISTIC` | PD collection fact, policy link fact, scan coverage | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Incomplete/shallow/blocked coverage prevents absence conclusion | Yes, active | None |
| `PD-002` | `DETERMINISTIC` | Policy URL/link and HTTP/browser accessibility | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Policy URL not observed | Yes, active | None |
| `PD-003` | `DETERMINISTIC` | PD collection page, local/global policy access evidence | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Incomplete coverage prevents missing-access conclusion | Yes, active | None |
| `PD-004` | `DETERMINISTIC` | Policy URL plus unrestricted access/auth/error evidence | Partial | `PASS`, `FAIL`, `NO_EVALUATION` | Access restriction ambiguous or document not reached | Candidate | Add narrow deterministic `policy_unrestricted_access` fact from existing crawl/browser responses |
| `PD-005` | `LLM_SEMANTIC` | Consent control DOM and associated text/links | Yes for text/control; semantic classifier missing | `PASS`, `WARNING`, `NO_EVALUATION` initially | Consent text cannot be confidently separated from terms/offer | No | LLM reviewer fact: `combined_confirmation_with_other_documents` with evidence spans |
| `PD-006` | `DETERMINISTIC` | PD consent control and rendered checked state | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Only static/provisional checked state available | Candidate | Deterministic evaluator using `rendered_consent_checked` and golden cases |
| `PD-007` | `OWNER_MANUAL` | PD form, related text, absence of visible consent mechanism | Partial | `MANUAL_CHECK`, `NO_EVALUATION` | PD collection found but legal basis cannot be proven from public UI | Candidate for manual check only | Deterministic/manual evaluator that never escalates missing checkbox to `FAIL` |
| `PD-008` | `LLM_SEMANTIC` | Consent text and span-level purpose analysis | Text present; semantic classifier missing | `PASS`, `WARNING`, `NO_EVALUATION` | Purpose wording ambiguous or text too short/fragmented | No | LLM reviewer fact: `clear_processing_purpose_detected` with supporting spans |
| `PD-009` | `LLM_SEMANTIC` | Consent text and blanket wording analysis | Text present; semantic classifier missing | `PASS`, `WARNING`, `NO_EVALUATION` | Broad wording uncertain without full consent context | No | LLM reviewer fact: `blanket_scope_detected` with exact phrase spans |
| `PD-010` | `LLM_SEMANTIC` | Service/order form, marketing consent text, bundling analysis | Partial | `PASS`, `WARNING`, `NO_EVALUATION` | Cannot distinguish separate marketing consent from bundled main action | No | LLM reviewer fact: `marketing_consent_bundled` |
| `PD-011` | `DETERMINISTIC` | Marketing consent control and rendered checked state | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Only static/provisional state available | Candidate | Deterministic evaluator using `rendered_marketing_consent_checked` and golden cases |
| `PD-012` | `OWNER_MANUAL` | Marketing/subscription UI and proof mechanism context | UI evidence partial; proof mechanism absent by nature | `MANUAL_CHECK`, `NO_EVALUATION` | Direct marketing intent found but consent proof storage/process unknown | Candidate for manual check only | Owner question/fact for consent proof mechanism |
| `PD-013` | `LLM_SEMANTIC` | Privacy policy text fragments and purpose extraction | Policy link yes; document text parsing not implemented | `PASS`, `WARNING`, `NO_EVALUATION` | Policy inaccessible, unavailable, or extraction confidence low | No | Fetch/extract policy text; LLM reviewer fact: `policy_purposes_detected` |
| `PD-014` | `LLM_SEMANTIC` | Policy text and categories/data list extraction | No document text pipeline | `PASS`, `WARNING`, `NO_EVALUATION` | Policy text missing or category wording ambiguous | No | Policy text evidence plus LLM fact: `policy_data_categories_detected` |
| `PD-015` | `LLM_SEMANTIC` | Policy text and retention/deletion procedure extraction | No document text pipeline | `PASS`, `WARNING`, `NO_EVALUATION` | Policy text missing or retention wording ambiguous | No | Policy text evidence plus LLM fact: `retention_or_deletion_rules_detected` |
| `PD-016` | `LLM_SEMANTIC` | Policy text and subject request procedure extraction | No document text pipeline | `PASS`, `WARNING`, `NO_EVALUATION` | Policy text missing or request procedure ambiguous | No | Policy text evidence plus LLM fact: `subject_request_procedure_detected` |
| `PD-017` | `LLM_SEMANTIC` | Form fields plus policy data-category coverage comparison | Form fields yes; policy parsing missing | `PASS`, `WARNING`, `NO_EVALUATION` | Policy unavailable or field/category mapping uncertain | No | LLM comparison fact: `collected_fields_not_covered_by_policy` |
| `PD-018` | `LLM_SEMANTIC` | External service evidence plus policy/service disclosure comparison | External service evidence yes; policy parsing missing | `PASS`, `WARNING`, `NO_EVALUATION` | Service role cannot be inferred or policy unavailable | No | LLM reviewer fact: `service_not_reflected_in_policy` |
| `PD-019` | `LLM_SEMANTIC` | Policy no-third-party-transfer claim plus third-party service evidence | Third-party service evidence yes; policy claim parsing missing | `PASS`, `WARNING`, `NO_EVALUATION` | Claim wording ambiguous or service role unclear | No | LLM reviewer fact: `policy_no_third_party_transfer_claim` |
| `PD-020` | `OWNER_MANUAL` | PD collection page plus foreign provider/endpoint signal | Mostly yes via browser/network/catalog | `MANUAL_CHECK`, `NO_EVALUATION` | Foreign service on PD page but actual data transfer/role unknown | Candidate for manual check only | Link service signal to PD collection page; owner context later for actual flow |
| `PD-021` | `DETERMINISTIC` | Form action/config target and provider/host scope | Partial: form action exists; JS config extraction limited | `PASS`, `WARNING`, `NO_EVALUATION` | Target not visible or host/provider classification uncertain | Candidate | Deterministic foreign-host matcher for `form_action_target` / `rendered_form_action_target`; no localization `FAIL` |
| `PD-022` | `OWNER_MANUAL` | PD collection evidence plus database location context | PD collection yes; DB location never externally knowable | `MANUAL_CHECK`, `NO_EVALUATION` | Any PD collection with unknown primary DB location | Candidate for manual check only | Owner question/fact for primary DB location |
| `PD-023` | `OWNER_MANUAL` | Confident operator identity, automated processing, RKN registry result | Operator identity/registry lookup absent | `WARNING`, `MANUAL_CHECK`, `NO_EVALUATION` | Operator identity uncertain or registry search needs confirmation | No | Owner/operator identification and registry lookup workflow |
| `PD-024` | `LLM_SEMANTIC` | Form field names, labels, and context indicating special categories | Form fields yes; semantic classifier missing | `MANUAL_CHECK`, `NO_EVALUATION` | Special category suspicion without legal basis/context | No | LLM reviewer fact: `special_category_field_or_context_detected` |
| `EC-001` | `DETERMINISTIC` | E-commerce applicability, offer link absence, complete coverage | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Shallow/blocked/incomplete coverage | Yes, active | None |
| `EC-002` | `DETERMINISTIC` | Offer URL/link and accessibility result | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Offer URL not observed | Yes, active | None |
| `EC-003` | `DETERMINISTIC` | Seller kind legal entity, legal name candidate/absence, coverage | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Seller kind uncertain or coverage incomplete | Yes, active | None |
| `EC-004` | `DETERMINISTIC` | Seller kind legal entity, OGRN candidate/absence, coverage | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Seller kind uncertain or coverage incomplete | Yes, active | None |
| `EC-005` | `DETERMINISTIC` | Seller kind legal entity, address candidate/absence, coverage | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Seller kind uncertain or coverage incomplete | Yes, active | None |
| `EC-006` | `DETERMINISTIC` | Seller kind legal entity, email/phone presence/absence, coverage | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Seller kind uncertain or coverage incomplete | Yes, active | None |
| `EC-007` | `DETERMINISTIC` | Seller kind IP, FIO candidate/absence, coverage | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Seller kind uncertain or coverage incomplete | Yes, active | None |
| `EC-008` | `DETERMINISTIC` | Seller kind IP, OGRNIP candidate/absence, coverage | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Seller kind uncertain or coverage incomplete | Yes, active | None |
| `EC-009` | `DETERMINISTIC` | Seller kind IP, email/phone presence/absence, coverage | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Seller kind uncertain or coverage incomplete | Yes, active | None |
| `EC-010` | `LLM_SEMANTIC` | Offer/return/contact/FAQ text about complaint submission | No semantic document/page extraction | `PASS`, `FAIL`, `NO_EVALUATION` cautiously | Complaint wording absent but coverage/document evidence incomplete | No | LLM reviewer fact: `complaint_submission_info_found` over relevant documents/pages |
| `EC-011` | `DETERMINISTIC` | Checkout-like page, paid add-on control, rendered preselected state, price context | Partial: paid add-on facts exist; page discovery limited | `PASS`, `FAIL`, `NO_EVALUATION` | Checkout/add-on page not reached | Candidate | Golden cases and deterministic evaluator; do not broaden crawler unless review requires |
| `EC-012` | `LLM_SEMANTIC` | Checkout UI/terms proving add-on required for primary purchase | Partial control evidence; no interaction/semantic requirement proof | `WARNING`, `MANUAL_CHECK`, `NO_EVALUATION` initially | Requirement cannot be proven without safe interaction or owner context | No | LLM reviewer over checkout text/terms; owner/manual confirmation for hard `FAIL` |
| `EC-013` | `DETERMINISTIC` | Consumer offer/price evidence and ruble price absence with coverage | Yes | `PASS`, `FAIL`, `NO_EVALUATION` | Consumer offer or coverage uncertain | Yes, active | None |
| `ADV-001` | `OWNER_MANUAL` | Confirmed internet ad plus label absence | Only possible label text; ad qualification absent | `MANUAL_CHECK`, `NO_EVALUATION`; `FAIL` only after confirmed ad qualification | Whether block is legally internet advertising is uncertain | No | Ad-candidate semantic review and product/legal approval path for `internet_ad_confirmed` |
| `ADV-002` | `OWNER_MANUAL` | Confirmed internet ad plus advertiser identity/link absence | Ad qualification absent | `MANUAL_CHECK`, `NO_EVALUATION`; `FAIL` only after confirmed ad qualification | Advertising qualification or advertiser role uncertain | No | Same as `ADV-001`, plus semantic extraction of advertiser identity/link |
| `ADV-003` | `OWNER_MANUAL` | Confirmed internet ad plus ERID token search | ERID candidate fact possible; ad applicability absent | `MANUAL_CHECK`, `NO_EVALUATION` | Marking applicability or ad qualification uncertain | No | Owner/legal context for campaign/ad status; deterministic ERID search can remain supporting evidence |
| `ADV-004` | `OWNER_MANUAL` | Marketing subscription UI plus consent proof process | UI evidence partial; proof process not public | `MANUAL_CHECK`, `NO_EVALUATION` | Subscription found but consent proof mechanism unknown | Candidate for manual check only | Owner question/fact for advertising consent proof mechanism |
| `AUTH-001` | `OWNER_MANUAL` | Russian owner confirmation, auth-required evidence, auth provider candidates | Auth candidates partial; owner and legal method validation missing | `MANUAL_CHECK`, `NO_EVALUATION` | Owner nationality or allowed method applicability uncertain | No | Owner identity context and controlled list of allowed auth methods |
| `REC-001` | `OWNER_MANUAL` | Recommendation technology suspicion and missing notice | Static notice candidate possible; technology confirmation absent | `MANUAL_CHECK`, `NO_EVALUATION` | Recommendation tech is suspected but not confirmed | No | Owner/manual or approved semantic classifier for recommendation technology use |
| `REC-002` | `OWNER_MANUAL` | Confirmed recommender technology and rules document search | Document link fact partial; confirmation absent | `FAIL`, `MANUAL_CHECK`, `NO_EVALUATION` | Recommendation tech not confirmed | No | Owner/manual fact: `recommendation_technology_confirmed`; then deterministic/semantic document search |
| `REC-003` | `LLM_SEMANTIC` | Recommendation rules URL, access result, Russian language/text evidence | Document link/access partial; language/content review missing | `PASS`, `FAIL`, `NO_EVALUATION` after confirmation | Recommender applicability not confirmed or language confidence low | No | Text extraction/language reviewer for rules document |
| `REC-004` | `OWNER_MANUAL` | Confirmed recommender technology, owner info, legal e-mail | Contact facts partial; confirmation absent | `FAIL`, `MANUAL_CHECK`, `NO_EVALUATION` | Recommendation tech not confirmed or owner role unclear | No | Owner/manual recommender confirmation; semantic extraction from rules/contact page |
| `CON-001` | `DETERMINISTIC` | B2C service, seller kind legal entity, name/address/hours presence | Yes | `PASS`, `WARNING`, `NO_EVALUATION` | Seller kind uncertain or website channel role unclear | Yes, active | None |
| `CON-002` | `DETERMINISTIC` | B2C service, seller kind IP, registration info presence | Yes | `PASS`, `WARNING`, `NO_EVALUATION` | Seller kind uncertain or website channel role unclear | Yes, active | None |
| `LANG-001` | `LLM_SEMANTIC` | Mandatory consumer information fragment and absence of Russian equivalent | Page language signal partial; mandatory-info classification missing | `PASS`, `FAIL`, `NO_EVALUATION` cautiously | Text is not confidently mandatory consumer information | No | LLM reviewer fact: `consumer_mandatory_information_confirmed` and `russian_equivalent_found` |
| `LANG-002` | `OWNER_MANUAL` | Foreign-only public consumer info plus exception analysis | Page language signal partial; exception context absent | `WARNING`, `MANUAL_CHECK`, `NO_EVALUATION` | Trademark/name/exception applicability unknown | No | Semantic foreign-only detection plus owner/legal exception check |

## Activation Summary

### Already Runtime Active

`PD-001`, `PD-002`, `PD-003`, `EC-001`, `EC-002`, `EC-003`, `EC-004`, `EC-005`, `EC-006`, `EC-007`, `EC-008`, `EC-009`, `EC-013`, `CON-001`, `CON-002`.

### Near-Term Deterministic Candidates

These have enough or nearly enough evidence, but should only be activated after explicit golden cases and evaluator review:

- `PD-004`
- `PD-006`
- `PD-011`
- `PD-021`
- `EC-011`

### Stage 2 LLM Semantic Reviewer Candidates

Highest leverage rules for the first semantic reviewer artifact:

- Consent text: `PD-005`, `PD-008`, `PD-009`, `PD-010`
- Policy content: `PD-013`, `PD-014`, `PD-015`, `PD-016`
- Document reality check lite: `PD-017`, `PD-018`, `PD-019`
- Special/sensitive text signals: `PD-024`, `EC-010`, `EC-012`, `REC-003`, `LANG-001`

### Owner/Manual Context Rules

These should not become automatic deterministic or LLM-only `FAIL` rules:

- `PD-007`, `PD-012`, `PD-020`, `PD-022`, `PD-023`
- `ADV-001`, `ADV-002`, `ADV-003`, `ADV-004`
- `AUTH-001`
- `REC-001`, `REC-002`, `REC-004`
- `LANG-002`

## Stage 2 Implications

1. Do not broaden crawler/browser facts by default.
2. Build the LLM Semantic Reviewer around structured fact output with evidence spans:
   - source document/page URL;
   - source evidence id;
   - extracted claim/fact type;
   - quoted span or compact text fragment;
   - confidence;
   - limitation reason.
3. Keep final rule status controlled by deterministic evaluator logic.
4. For ambiguous semantic output, prefer `NO_EVALUATION`, `WARNING`, or `MANUAL_CHECK`; do not promote to `FAIL`.
5. The first semantic benchmark should cover consent text and policy content before advertising, recommender technology, or language exceptions.
