# RF Website Compliance MVP

Minimal local scaffold for the approved MVP architecture:

```text
Website -> Scan -> Facts + Evidence -> Rule Engine -> Findings
```

The current MVP has Basic Crawl, static Facts/Evidence, targeted Playwright audit, External Services detection, deterministic Rule Engine, Findings, and a minimal Results UI.

HTTP routes only create `QUEUED` scans. The scan pipeline runs in a separate worker process.

## Install

```bash
npm install
```

## Environment

Create `.env` from `.env.example`:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/compliance_mvp
NODE_ENV=development
PORT=3000
DEV_USER_EMAIL=dev@example.test
BETA_ACCESS_PASSWORD=
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=
SCAN_WORKER_IDLE_DELAY_MS=2000
SCAN_STALE_RUNNING_THRESHOLD_MS=1800000
```

## Local PostgreSQL

Use any local PostgreSQL instance. One simple option is to create a database named `compliance_mvp` and point `DATABASE_URL` at it.

Docker infrastructure is not included in this scaffold.

## Apply schema

```bash
npm run db:migrate
```

## Seed development user

```bash
npm run db:seed
```

Auth is not implemented yet. Local development can use the seeded user until auth is handled before closed beta.

## Run app

```bash
npm run dev
```

## Run scan worker

The worker claims the next `QUEUED` scan from PostgreSQL and runs the existing scanner pipeline.

```bash
npm run worker
```

On startup it marks stale `RUNNING` scans older than `SCAN_STALE_RUNNING_THRESHOLD_MS` as `FAILED`. This avoids reusing a possibly partial evidence set after a worker crash.

## Run no-op scan worker

The no-op worker remains useful for lifecycle checks.

```bash
npm run worker:no-op
```

To test a failed lifecycle:

```bash
NO_OP_SCAN_FAIL_REASON="synthetic failure" npm run worker:no-op
```

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Staging

See `STAGING_DEPLOYMENT.md` and `CLOSED_BETA_CHECKLIST.md`.
