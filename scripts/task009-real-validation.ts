import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { getPool } from "@/db/client";
import {
  createQueuedScan,
  createSite,
  getEvidenceForScan,
  getFactsForScan,
  getFindingsForScan,
  getSiteByUserAndNormalizedDomain,
  upsertUser
} from "@/db/repository";
import { DEVELOPMENT_USER_ID } from "@/db/seed-dev-user";
import { runMigrations } from "@/db/migrate";
import { runStaticExtractionScanLifecycle } from "@/jobs/scan-queue";
import { normalizeUserUrl } from "@/scanner/normalization/url";
import { formatExternalServices, summarizeFindings } from "@/app/results/presentation";
import type { SiteType } from "@/db/schema";

type RealSiteTarget = {
  url: string;
  siteType: SiteType;
  category: string;
};

const targets: RealSiteTarget[] = [
  { url: "https://hh.ru/", siteType: "B2C_SERVICE", category: "B2C/B2B service" },
  { url: "https://vc.ru/", siteType: "OTHER", category: "Commercial media/community" },
  { url: "https://www.chitai-gorod.ru/", siteType: "ECOMMERCE", category: "E-commerce" },
  { url: "https://www.detmir.ru/", siteType: "ECOMMERCE", category: "E-commerce" },
  { url: "https://www.citilink.ru/", siteType: "ECOMMERCE", category: "E-commerce" },
  { url: "https://tilda.cc/ru/", siteType: "B2B", category: "JS-heavy / builder" }
];

async function main() {
  loadDotEnvLocal();
  await runMigrations();
  const smoke = await runSmokeTest();
  const scans = [];

  for (const target of targets) {
    scans.push(await runRealSiteScan(target));
  }

  console.log(JSON.stringify({ smoke, scans }, null, 2));
  await getPool().end();
}

async function runSmokeTest() {
  const db = getPool();
  const ids = {
    user: "10000000-0000-4000-8000-000000000009",
    email: "task009-smoke@example.test",
    domain: "task009-smoke.example",
    fact: randomUUID(),
    evidence: randomUUID(),
    finding: randomUUID()
  };
  const created: { siteId?: string; scanId?: string; factId?: string; evidenceId?: string; findingId?: string } = {};

  try {
    const user = await upsertUser(db, { id: ids.user, email: ids.email });
    const site = await createSite(db, {
      userId: user.id,
      url: `https://${ids.domain}`,
      normalizedDomain: ids.domain
    });
    created.siteId = site.id;

    const scan = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "B2B",
      scannerVersion: "task009-smoke"
    });
    created.scanId = scan.id;

    await db.query("update scans set status = $2, started_at = now() where id = $1", [scan.id, "RUNNING"]);

    const factResult = await db.query<{ id: string }>(
      `
        insert into facts (id, scan_id, page_url, fact_type, value_json, created_at)
        values ($1, $2, null, $3, $4, now())
        returning id
      `,
      [ids.fact, scan.id, "task009_smoke_fact", { ok: true }]
    );
    created.factId = factResult.rows[0].id;

    const evidenceResult = await db.query<{ id: string }>(
      `
        insert into evidence (id, scan_id, fact_id, evidence_type, page_url, payload_json, created_at)
        values ($1, $2, $3, $4, $5, $6, now())
        returning id
      `,
      [
        ids.evidence,
        scan.id,
        created.factId,
        "TEXT_FRAGMENT",
        `https://${ids.domain}`,
        { context: "task009 smoke" }
      ]
    );
    created.evidenceId = evidenceResult.rows[0].id;

    const findingResult = await db.query<{ id: string }>(
      `
        insert into findings (
          id, scan_id, rule_id, rule_version, status, severity, confidence,
          summary, explanation, remediation, missing_context, created_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, ARRAY[]::text[], now()
        )
        returning id
      `,
      [
        ids.finding,
        scan.id,
        "TASK009-SMOKE",
        "1",
        "PASS",
        "LOW",
        1,
        "Task009 smoke finding",
        "Smoke chain persisted.",
        "No action."
      ]
    );
    created.findingId = findingResult.rows[0].id;

    await db.query("insert into finding_evidence (finding_id, evidence_id) values ($1, $2)", [
      created.findingId,
      created.evidenceId
    ]);
    await db.query("update scans set status = $2, finished_at = now() where id = $1", [scan.id, "COMPLETED"]);

    const check = await db.query<{ status: string; evidence_links: number }>(
      `
        select s.status, count(fe.evidence_id)::int as evidence_links
        from scans s
        join findings f on f.scan_id = s.id
        join finding_evidence fe on fe.finding_id = f.id
        where s.id = $1
        group by s.status
      `,
      [scan.id]
    );

    return {
      status: "passed",
      scanStatus: check.rows[0]?.status,
      findingEvidenceLinks: check.rows[0]?.evidence_links ?? 0
    };
  } finally {
    if (created.findingId) {
      await db.query("delete from finding_evidence where finding_id = $1", [created.findingId]).catch(() => undefined);
      await db.query("delete from findings where id = $1", [created.findingId]).catch(() => undefined);
    }
    if (created.evidenceId) {
      await db.query("delete from evidence where id = $1", [created.evidenceId]).catch(() => undefined);
    }
    if (created.factId) {
      await db.query("delete from facts where id = $1", [created.factId]).catch(() => undefined);
    }
    if (created.scanId) {
      await db.query("delete from scans where id = $1", [created.scanId]).catch(() => undefined);
    }
    if (created.siteId) {
      await db.query("delete from sites where id = $1", [created.siteId]).catch(() => undefined);
    }
    await db.query("delete from users where id = $1", [ids.user]).catch(() => undefined);
  }
}

async function runRealSiteScan(target: RealSiteTarget) {
  const db = getPool();
  const normalized = normalizeUserUrl(target.url);
  const user = await upsertUser(db, {
    id: DEVELOPMENT_USER_ID,
    email: process.env.DEV_USER_EMAIL ?? "dev@example.test"
  });
  const existingSite = await getSiteByUserAndNormalizedDomain(db, {
    userId: user.id,
    normalizedDomain: normalized.normalizedDomain
  });
  const site =
    existingSite ??
    (await createSite(db, {
      userId: user.id,
      url: normalized.canonicalStartUrl,
      normalizedDomain: normalized.normalizedDomain
    }));
  const scan = await createQueuedScan(db, {
    siteId: site.id,
    siteType: target.siteType,
    scannerVersion: "task009-real-validation"
  });
  const started = performance.now();
  const result = await runStaticExtractionScanLifecycle(db, {
    scanId: scan.id,
    startUrl: normalized.canonicalStartUrl,
    crawlOptions: { config: { maxPages: 8, totalTimeoutMs: 45_000, requestTimeoutMs: 12_000 } },
    browserAuditOptions: { config: { maxBrowserPages: 5, navigationTimeoutMs: 15_000, settleDelayMs: 750 } }
  });
  const durationMs = Math.round(performance.now() - started);
  const facts = await getFactsForScan(db, scan.id);
  const evidence = await getEvidenceForScan(db, scan.id);
  const findings = await getFindingsForScan(db, scan.id);
  const summary = summarizeFindings(findings);
  const externalServiceFact = facts.find((fact) => fact.factType === "external_service_detected");
  const browserCoverage = facts.find((fact) => fact.factType === "browser_audit_coverage");
  const pagesCrawled = result?.crawlResult?.pages.length ?? 0;

  return {
    url: target.url,
    normalizedDomain: normalized.normalizedDomain,
    category: target.category,
    siteType: target.siteType,
    scanId: scan.id,
    scanStatus: result?.scan.status ?? "FAILED",
    statusReason: result?.scan.statusReason ?? null,
    durationMs,
    pagesCrawled,
    browserPagesAudited:
      typeof browserCoverage?.value.completed === "number" ? browserCoverage.value.completed : null,
    browserPagesAttempted:
      typeof browserCoverage?.value.attempted === "number" ? browserCoverage.value.attempted : null,
    browserPagesFailed:
      typeof browserCoverage?.value.failed === "number" ? browserCoverage.value.failed : null,
    browserFailures: Array.isArray(browserCoverage?.value.failures) ? browserCoverage.value.failures : [],
    externalServicesDetected: externalServiceFact ? formatExternalServices(externalServiceFact.value) : [],
    pass: summary.pass,
    fail: summary.fail,
    warning: summary.warning,
    manualCheck: summary.manual,
    findingRuleStatuses: findings.map((finding) => ({
      ruleId: finding.ruleId,
      status: finding.status,
      summary: finding.summary
    })),
    factCount: facts.length,
    evidenceCount: evidence.length
  };
}

function loadDotEnvLocal() {
  const raw = readFileSync(".env.local", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] = value;
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (process.env.DATABASE_URL) {
    await getPool().end().catch(() => undefined);
  }
  process.exit(1);
});
