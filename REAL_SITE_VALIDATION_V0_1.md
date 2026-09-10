# REAL_SITE_VALIDATION_V0_1.md

## Status

Task 009 validation continued after `DATABASE_URL` became available in `.env.local`.

Real PostgreSQL was used for smoke testing and real-site validation. No Docker, second PostgreSQL instance, new database platform, Redis, deployment, auth, payments, monitoring, PDF, LLM, owner questionnaire, or new product feature was added.

## Database

- `DATABASE_URL`: present in `.env.local`; value was not printed.
- Migration: existing `src/db/migrations/001_initial_schema.sql` applied successfully through `npm.cmd run db:migrate`.
- Real PostgreSQL smoke test: passed.
- Smoke chain verified:

```text
development/test user
-> Site
-> Scan
-> Fact
-> Evidence
-> Finding
-> finding_evidence
```

Smoke result:

- scan status: `COMPLETED`;
- finding/evidence links: 1;
- smoke data cleanup: completed.

## Synthetic E2E Scenario

Synthetic scenario remains covered by `tests/app/synthetic-e2e-pipeline.test.ts`.

Scenario shape:

```text
HTML fixture
-> crawl
-> static facts + evidence
-> targeted browser audit
-> external services detection
-> derived facts
-> Rule Engine
-> Findings
```

Observed synthetic result:

- scan status: `COMPLETED`;
- pages crawled: 5;
- external services detected: Google tag / Google Analytics;
- findings persisted: yes;
- `PD-001`: `PASS`;
- `EC-001`: `PASS`;
- FAIL findings: 0;
- persisted serialized facts/evidence did not include full test e-mail or phone values.

## Real Sites

Final real-site validation run:

| URL/domain | site_type | scan status | duration | pages crawled | browser pages audited | external services detected | PASS | FAIL | WARNING | MANUAL_CHECK | observed issues | suspected false positives | suspected false negatives | technical failures |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---|---|---|---|
| `https://hh.ru/` | `B2C_SERVICE` | `COMPLETED` | 7.2s | 1 | 1 / 1 attempted | Top.Mail.Ru; Yandex Metrica | 1 | 0 | 0 | 0 | Browser redirected to `/vpncheeck`; crawl coverage is shallow. | None after final run. | Possible: only one page was crawled; forms behind interaction/login are not covered. | None in final run. |
| `https://vc.ru/` | `OTHER` | `FAILED` | 7.8s | 0 | N/A | None | 0 | 0 | 0 | 0 | Response body exceeded current crawler limit. | N/A | N/A | `Response body too large`. |
| `https://www.chitai-gorod.ru/` | `ECOMMERCE` | `COMPLETED` | 5.2s | 1 | 1 / 1 attempted | None | 0 | 0 | 0 | 0 | Site returned limited/blocked page; absence-based rules correctly did not produce FAIL after fix. | Initial run produced EC-001 FAIL from insufficient coverage; fixed. | Likely: offer/seller details may exist but were not reachable in crawled content. | Coverage limitation, not final scan failure. |
| `https://www.detmir.ru/` | `ECOMMERCE` | `COMPLETED` | 3.0s | 1 | 1 / 1 attempted | None | 0 | 0 | 0 | 0 | Site returned limited/blocked page; absence-based rules correctly did not produce FAIL after fix. | Initial run produced EC-001 FAIL from insufficient coverage; fixed. | Likely: offer/seller details may exist but were not reachable in crawled content. | Coverage limitation, not final scan failure. |
| `https://www.citilink.ru/` | `ECOMMERCE` | `COMPLETED` | 4.1s | 1 | 1 / 1 attempted | None | 0 | 0 | 0 | 0 | Site returned limited/rate-limited page; absence-based rules correctly did not produce FAIL after fix. | Initial run produced EC-001 FAIL from insufficient coverage; fixed. | Likely: offer/seller details may exist but were not reachable in crawled content. | Coverage limitation, not final scan failure. |
| `https://tilda.cc/ru/` | `B2B` | `COMPLETED` | 15.3s | 8 | 5 / 5 attempted | None | 1 | 0 | 0 | 0 | Page limit reached; absence-based rules should remain cautious. | None after final run. | Possible: services not in enabled catalog are not reported; deeper pages beyond limit are not covered. | None in final run. |

Completed scans: 5 of 6 attempted.

Site-type coverage:

- B2B / JS-heavy builder: 1 completed.
- B2C/B2B service: 1 completed.
- E-commerce: 3 completed.
- Other/commercial media: 1 attempted, failed due response-size limit.

## False-Positive Audit

Initial real run produced suspected false positives:

- `EC-001` FAIL on `www.chitai-gorod.ru`;
- `EC-001` FAIL on `www.detmir.ru`;
- `EC-001` FAIL on `www.citilink.ru`.

Manual assessment:

- status: `FALSE_POSITIVE`;
- source: coverage/applicability guard for absence-based rules;
- reason: crawler had only one blocked/limited/error page, but Rule Engine treated crawl as complete enough to infer site-wide absence of offer;
- fix: `scan_coverage` now includes `successfulHtmlPages`, `httpErrorPages`, and `maxPagesReached`; absence-based complete coverage requires no page-limit cap, at least one successful HTML page, and zero HTTP error pages;
- regression: added rule-engine test that EC-001 does not trigger on capped or blocked coverage.

Final real run produced 0 FAIL findings, so no unresolved real-site FAIL remained to audit.

## Technical Defects Found and Fixed

### 1. Pinned DNS lookup callback did not support Node's `all: true` mode

- symptom: all real scans failed immediately with `Scan failed`;
- raw diagnostic: `Invalid IP address: undefined`;
- source: crawler HTTP transport custom `lookup` callback;
- fix: `createPinnedLookup` now returns either a single address or an address array depending on `options.all`;
- regression: added a unit test for both lookup modes.

### 2. Browser audit failed under `tsx` runner because `page.evaluate` saw a transpiler helper

- symptom: browser coverage attempted pages but completed 0 with `ReferenceError: __name is not defined`;
- source: browser evaluation context receiving transformed helper from TS/esbuild runtime;
- fix: browser page context now defines a no-op `globalThis.__name` before rendered fact extraction;
- validation: subsequent real-site run completed browser audit on selected pages.

### 3. Absence-based rules were too confident on blocked/limited pages

- symptom: EC-001 FAIL on e-commerce sites when only blocked/limited page content was available;
- source: Rule Engine coverage guard;
- fix: stricter `completeCoverage` guard using successful HTML pages, HTTP error pages, and page-limit status;
- regression: added a rule-engine test.

## External Services Notes

- HH detected enabled catalog services: Top.Mail.Ru and Yandex Metrica.
- No detected service was treated as a legal violation.
- Several sites likely expose services that were not reported because pages were blocked/limited, the browser page set was intentionally small, or catalog entries are disabled candidates.
- No new catalog entry was enabled during Task 009.

## UI E2E Smoke

Local dev server:

- `npm.cmd run dev`;
- Next loaded `.env.local`;
- local URL: `http://localhost:3000`.

Checked routes:

- `/`: HTTP 200, contains `Проверка сайта`;
- `/scan/[scanId]`: HTTP 200, renders scan state view;
- `/results/[completedScanId]`: HTTP 200, contains `Результаты проверки`;
- `/results/[failedScanId]`: HTTP 200, contains safe failed-scan message `Не удалось проверить сайт`.

Cold dev compilation made the first result requests slow, but the routes returned 200 after compilation.

## Coverage and Quality Limitations

- Real commercial sites frequently block, rate-limit, redirect, or return very large pages to a simple crawler.
- One-page completed scans should not be interpreted as legal completeness.
- Browser audit now runs, but only on the selected page set and without clicking modal openers or submitting forms.
- Forms hidden behind interaction, login, checkout flows, or anti-bot gates remain out of scope.
- External service detection is limited to enabled catalog signatures and collected script/iframe/network observations.
- No real-site FAIL remained after fixes; real-world legal correctness still needs broader site coverage and expert review before closed beta.

## Changes Made

- `src/scanner/crawl/fetch.ts`: fixed pinned DNS lookup callback for Node `all: true` lookup mode.
- `src/scanner/browser/audit.ts`: fixed browser evaluation under `tsx`/esbuild helper injection.
- `src/facts/extractors/static-html.ts`: added coverage metadata for successful HTML pages and HTTP error pages.
- `src/rule-engine/evaluator.ts`: made absence-based complete-coverage guard stricter.
- `tests/scanner/basic-crawler.test.ts`: added regression for pinned lookup modes.
- `tests/rule-engine/wave1.test.ts`: added regression for absence-based EC-001 on capped/blocked coverage.
- `tests/app/synthetic-e2e-pipeline.test.ts`: kept full synthetic E2E coverage.
- `scripts/task009-real-validation.ts`: added local validation runner for Task 009 only.
- `vitest.config.ts`: test files run sequentially to avoid Playwright tests competing for local browser resources.
- `REAL_SITE_VALIDATION_V0_1.md`: updated with real PostgreSQL and real-site validation results.

No dependencies were added.

## Checks

- `npm.cmd test`: passed, 10 test files and 82 tests.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed after stopping the local dev server.

Note: `next build` still prints the existing Windows native SWC warning and uses WASM bindings, but exits successfully.

## Remaining Blockers

- Real commercial sites often block shallow crawler/browser access; beta readiness needs a curated real-site validation set with stable access characteristics.
- Coverage UI should eventually explain when a scan is shallow or blocked; this was not added in Task 009 because it is a product/UI change.
- Closed beta still needs broader evidence quality review on sites where crawler reaches real forms, legal pages, seller details, and checkout-like pages.
