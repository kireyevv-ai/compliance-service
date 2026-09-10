# Architecture Draft MVP

## Goal and boundary

This document defines a minimal technical architecture for the MVP of the Russia-focused website compliance platform.

The invariant product core is:

```text
Website -> Scan -> Facts + Evidence -> Rule Engine -> Findings
```

The MVP architecture must support that chain without turning LLM output into legal decisions, without microservices, and without adding product areas outside the PRD.

## A. Project structure

Minimal directory structure:

```text
src/
  app/
    scan/
    results/
  scanner/
    url-safety/
    crawl/
    playwright-audit/
    normalization/
  facts/
    extractors/
    types.ts
  evidence/
    collectors/
    storage.ts
    types.ts
  rule-engine/
    evaluator.ts
    types.ts
  findings/
    builder.ts
    types.ts
  db/
    client.ts
    schema.ts
  jobs/
    scan-queue.ts
  legal-rules/
    rules/
    schema.ts
  external-services/
    catalog/
    schema.ts

tests/
  fixtures/
    synthetic-sites/
    golden-dataset/
  scanner/
  rule-engine/
  security/
```

Notes:

- `src/app` contains only MVP UI routes: URL entry, scan progress, results.
- `src/scanner` owns safe URL validation, crawling, and Playwright audit orchestration.
- `src/facts` converts raw scan observations into normalized facts.
- `src/evidence` stores proof objects independently from findings.
- `src/rule-engine` evaluates versioned rules against facts and evidence.
- `src/findings` converts rule evaluations into persisted findings.
- `src/legal-rules` stores versioned MVP legal rule definitions.
- `src/external-services` stores the known service catalog.
- No directories are added for payments, monitoring, owner questionnaire, agency, API, CI/CD, document AI, or auto-fix.

## B. Data model

### PostgreSQL tables

```sql
users (
  id uuid primary key,
  email text not null unique,
  created_at timestamptz not null
)

sites (
  id uuid primary key,
  user_id uuid not null references users(id),
  url text not null,
  normalized_domain text not null,
  created_at timestamptz not null
)

scans (
  id uuid primary key,
  site_id uuid not null references sites(id),
  status text not null,
  status_reason text,
  site_type text not null,
  scanner_version text not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null
)

facts (
  id uuid primary key,
  scan_id uuid not null references scans(id),
  page_url text,
  fact_type text not null,
  value_json jsonb not null,
  created_at timestamptz not null
)

evidence (
  id uuid primary key,
  scan_id uuid not null references scans(id),
  fact_id uuid references facts(id),
  evidence_type text not null,
  page_url text not null,
  payload_json jsonb,
  storage_ref text,
  created_at timestamptz not null
)

findings (
  id uuid primary key,
  scan_id uuid not null references scans(id),
  rule_id text not null,
  rule_version text not null,
  status text not null,
  severity text not null,
  confidence numeric not null,
  summary text not null,
  explanation text not null,
  remediation text not null,
  missing_context text[] not null default '{}',
  created_at timestamptz not null
)

finding_evidence (
  finding_id uuid not null references findings(id),
  evidence_id uuid not null references evidence(id),
  primary key (finding_id, evidence_id)
)
```

Recommended constraints:

- `scans.status` in `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`.
- `scans.site_type` in `B2B`, `B2C_SERVICE`, `ECOMMERCE`, `OTHER`.
- `findings.status` in `PASS`, `FAIL`, `WARNING`, `MANUAL_CHECK`.
- `facts.fact_type` and `evidence.evidence_type` are controlled by TypeScript enums or literal unions in the application layer.
- Indexes on `sites.user_id`, `sites.normalized_domain`, `scans.site_id`, `scans.site_type`, `facts.scan_id`, `facts.fact_type`, `evidence.scan_id`, `evidence.fact_id`, `findings.scan_id`, `findings.rule_id`, `finding_evidence.evidence_id`.

Every scan is immutable after completion from the product perspective: follow-up scans create new rows instead of overwriting old findings, facts, or evidence.

`scans.site_type` stores the site classification used by the Rule Engine for that specific scan. Do not add a separate classification table for MVP.

`facts.page_url` is nullable so later context facts can describe business-process context rather than a specific page. This supports future owner-provided context without implementing Owner Questionnaire now.

`finding_evidence` is the only relationship mechanism between findings and evidence. Do not store `evidence_ids` directly on `findings`, and do not add extra tables around this relation for MVP.

The `users` table remains part of the model, but a concrete authentication provider is not selected in this architecture draft. During the technical implementation stage, a development or seeded user is acceptable until authentication is handled as a separate task before closed beta.

### Rule storage: PostgreSQL vs versioned JSON/YAML

Option 1: `rules` and `rule_versions` in PostgreSQL.

- Pros: runtime editing, admin screens, database-level querying.
- Cons: requires admin workflows, migrations, validation UI, and more operational surface before the MVP needs them.

Option 2: versioned JSON/YAML in the repository.

- Pros: simplest MVP path, reviewable in Git, easy to validate in tests, stable rule versions can be copied into findings.
- Cons: non-technical edits require developer workflow; later runtime rule management will require import tables.

Decision for MVP: use versioned JSON/YAML in `src/legal-rules/rules`.

This does not create an expensive migration later because findings already persist `rule_id` and `rule_version`. If rules later move into PostgreSQL, historical findings remain interpretable by the stored rule identity and version.

### ExternalService storage: PostgreSQL vs versioned catalog

Option 1: PostgreSQL table.

- Pros: runtime updates and lookup management.
- Cons: requires admin/update process before the MVP proves catalog value.

Option 2: versioned JSON/YAML catalog in the repository.

- Pros: simple, testable, reviewable, enough for 30-50 known services in MVP.
- Cons: catalog updates require deployment.

Decision for MVP: use versioned JSON/YAML in `src/external-services/catalog`.

If later moved to PostgreSQL, scan facts can still store detected service IDs and catalog version notes in `value_json`.

## C. Scan lifecycle

Minimal states:

```text
QUEUED -> RUNNING -> COMPLETED
                 -> FAILED
```

State meanings:

- `QUEUED`: scan request accepted and waiting for a worker.
- `RUNNING`: URL safety checks, crawling, browser audit, fact extraction, rule evaluation, or finding creation is in progress.
- `COMPLETED`: scan produced facts, evidence, and findings.
- `FAILED`: scan could not finish. `status_reason` stores a safe technical reason, such as timeout, invalid URL, blocked private IP, or browser failure.

No separate paused, retrying, partially completed, or cancelled states are needed for MVP.

## D. Background jobs

Use PostgreSQL as the MVP scan queue.

Minimal approach:

- Insert a `scans` row with `QUEUED`.
- A scan worker claims the next eligible row using a database transaction and row locking.
- Worker sets status to `RUNNING`.
- Worker writes facts, evidence, and findings.
- Worker sets status to `COMPLETED` or `FAILED`.

Trade-off:

- PostgreSQL queue is simpler than Redis and sufficient for early closed beta volume.
- It keeps operational infrastructure small and inside the same Russian data plane.
- It is less specialized than a dedicated queue, but the MVP does not need complex scheduling, fan-out, or high-throughput retries.

Redis or a dedicated queue should be reconsidered only when scan concurrency, retry policy, or job observability become a proven bottleneck.

## E. Evidence storage

Store in PostgreSQL:

- page URL;
- evidence type;
- DOM or text fragments after PII minimization;
- network request metadata needed for proof;
- cookie/storage event metadata;
- document URL/reference;
- object `storage_ref` when payload is too large for PostgreSQL.

Store in object storage:

- screenshots that materially improve user understanding;
- large rendered DOM snapshots, if retained;
- large document copies, if retained later.

Screenshot evidence is included in closed beta, but only when it is genuinely useful as evidence. Do not create screenshots for every page.

Separate object storage is not mandatory for MVP. Evidence storage should allow `storage_ref` to point to persistent storage on a Russian VPS first, and later move to Russian S3-compatible storage without changing the Finding/Evidence contract.

Do not store production screenshots, HTML snapshots, scan logs, or evidence outside the Russian production contour.

## F. Rule Engine contract

The contract below is illustrative TypeScript shape, not application implementation.

```ts
type FindingStatus = "PASS" | "FAIL" | "WARNING" | "MANUAL_CHECK";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type SiteType = "B2B" | "B2C_SERVICE" | "ECOMMERCE" | "OTHER";

interface Fact {
  id: string;
  scanId: string;
  pageUrl?: string;
  factType: string;
  value: Record<string, unknown>;
  createdAt: string;
}

interface Evidence {
  id: string;
  scanId: string;
  factId?: string;
  evidenceType: "DOM_FRAGMENT" | "TEXT_FRAGMENT" | "NETWORK_EVENT" | "COOKIE_STORAGE_EVENT" | "DOCUMENT_REFERENCE" | "SCREENSHOT";
  pageUrl: string;
  payload?: Record<string, unknown>;
  storageRef?: string;
  createdAt: string;
}

interface Rule {
  ruleId: string;
  version: string;
  title: string;
  module: string;
  appliesTo: SiteType[];
  requiredFacts: string[];
  legalBasis: string[];
  severity: Severity;
  evaluation: RuleEvaluationDefinition;
  remediation: string;
  confidencePolicy: Record<string, unknown>;
  limitations: string[];
  effectiveFrom: string;
  effectiveTo?: string;
  lastVerifiedAt: string;
}

interface RuleEvaluationDefinition {
  kind: "FACT_PATTERN";
  conditions: Record<string, unknown>;
}

interface RuleEvaluation {
  ruleId: string;
  ruleVersion: string;
  status: FindingStatus;
  severity: Severity;
  confidence: number;
  summary: string;
  explanation: string;
  remediation: string;
  evidenceIds: string[];
  missingContext: string[];
}

interface Finding {
  id: string;
  scanId: string;
  ruleId: string;
  ruleVersion: string;
  status: FindingStatus;
  severity: Severity;
  confidence: number;
  summary: string;
  explanation: string;
  remediation: string;
  missingContext: string[];
  createdAt: string;
}
```

Contract rules:

- Rule Engine consumes normalized facts and evidence references, not raw HTML as the decision source.
- LLM may later assist semantic extraction, but it must produce facts or document structure for deterministic rules to evaluate.
- `FAIL` requires evidence.
- `WARNING` requires evidence or explicit missing legal/business context.
- `MANUAL_CHECK` is used when automatic proof is insufficient.
- New rules must not require scanner changes unless they need genuinely new fact types.
- Persisted findings are linked to evidence through `finding_evidence`, not through an array column on `findings`.

## G. Extensibility check

Owner Questionnaire:

- Add owner answers later as additional context facts or a small linked context table.
- Existing Rule Engine can evaluate rules using `missingContext` and newly available facts without changing the core chain.

Document Reality Check:

- Scanner already stores document references as evidence.
- Later document extraction can create normalized facts from those documents.
- Rule Engine remains facts plus evidence to findings.

Re-scan and Monitoring:

- Multiple scans per site already support historical comparison.
- Monitoring can schedule new scans later without changing `Scan`, `Fact`, `Evidence`, or `Finding`.

Compliance Passport:

- Can be generated from site, scan history, findings, rule versions, and evidence references.
- No separate MVP entity is required.

CMS remediation:

- MVP findings store text remediation.
- Later remediation can add structured templates keyed by rule, CMS, or detected platform without changing findings as legal outcomes.

## H. Security baseline

Minimum scanner security architecture:

- Normalize and validate submitted URLs before scan creation.
- Allow only `http` and `https`.
- Resolve hostnames before connecting and block localhost, private ranges, link-local ranges, loopback, multicast, and cloud metadata endpoints.
- Re-resolve and validate every redirect destination before following it.
- Protect against DNS rebinding by validating resolved IPs at connection time and on redirects.
- Enforce request timeout, page timeout, total scan timeout, response-size limits, and crawl page limits.
- Limit scan to the normalized domain and allowed internal pages.
- Run Playwright in an isolated worker context with no access to internal networks.
- Do not submit forms, make purchases, confirm subscriptions, or click dangerous irreversible controls.
- Apply conservative rate limits per user, domain, and worker.
- Store only minimized evidence payloads and mask personal values where full values are unnecessary.

## I. Testing foundation

Directory structure:

```text
tests/
  fixtures/
    synthetic-sites/
      form-without-policy/
      form-with-policy/
      prechecked-checkbox/
      unchecked-checkbox/
      cookie-before-consent/
      external-script/
      iframe/
      dynamic-rendered-form/
      ecommerce-seller-details/
      missing-seller-details/
    golden-dataset/
      rules-v0.1/
  scanner/
  rule-engine/
  security/
```

Test groups:

- Synthetic fixtures: small static or locally served pages with known expected facts.
- Golden dataset: expected `PASS`, `FAIL`, `WARNING`, and `MANUAL_CHECK` outcomes per rule.
- Scanner tests: URL normalization, crawl limits, rendered DOM extraction, forms, checkboxes, cookies, storage, scripts, iframes, external requests.
- Rule engine tests: deterministic rule evaluation from prepared facts and evidence.
- Security tests: localhost, `127.0.0.1`, private ranges, metadata endpoints, redirects to private IP, huge pages, infinite redirects, timeouts, broken JavaScript.

The first acceptance target is not maximum issue count. It is reproducible evidence-based output with very low critical false positives.

## Decisions requiring product owner approval

No open product-owner decisions remain in this draft.

Accepted decisions reflected above:

- Screenshot evidence is included in closed beta only where it is useful as evidence; screenshots are not created for every page.
- Separate object storage is not mandatory for MVP; `storage_ref` may point to persistent Russian VPS storage first and later move to Russian S3-compatible storage without changing the Finding/Evidence contract.
- A concrete authentication provider is not selected now; a development or seeded user is acceptable during the technical implementation stage, and authentication will be handled as a separate task before closed beta.
