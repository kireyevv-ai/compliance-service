import { readFileSync } from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import {
  claimNextQueuedScan,
  completeScan,
  createEvidence,
  createFact,
  createFinding,
  createQueuedScan,
  createSite,
  failScan,
  getEvidenceIdsForFinding,
  getScansForSite,
  upsertUser
} from "@/db/repository";
import type { Queryable } from "@/db/client";

function createTestDb(): Queryable {
  const db = newDb();
  const schema = readFileSync(
    path.join(process.cwd(), "src", "db", "migrations", "001_initial_schema.sql"),
    "utf8"
  );

  db.public.none(schema);

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();

  return pool;
}

describe("PostgreSQL scan lifecycle foundation", () => {
  let db: Queryable;

  beforeEach(() => {
    db = createTestDb();
  });

  async function createSeededSite() {
    const user = await upsertUser(db, {
      id: "00000000-0000-4000-8000-000000000001",
      email: "dev@example.test"
    });

    return createSite(db, {
      userId: user.id,
      url: "https://example.test",
      normalizedDomain: "example.test"
    });
  }

  it("creates a Site", async () => {
    const site = await createSeededSite();

    expect(site.url).toBe("https://example.test");
    expect(site.normalizedDomain).toBe("example.test");
  });

  it("creates a Scan with site_type", async () => {
    const site = await createSeededSite();
    const scan = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "B2B",
      scannerVersion: "test-scanner"
    });

    expect(scan.status).toBe("QUEUED");
    expect(scan.siteType).toBe("B2B");
  });

  it("runs lifecycle QUEUED -> RUNNING -> COMPLETED", async () => {
    const site = await createSeededSite();
    await createQueuedScan(db, {
      siteId: site.id,
      siteType: "B2C_SERVICE",
      scannerVersion: "test-scanner"
    });

    const running = await claimNextQueuedScan(db, { useSkipLocked: false });
    expect(running?.status).toBe("RUNNING");

    const completed = await completeScan(db, running!.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.finishedAt).toBeInstanceOf(Date);
  });

  it("runs lifecycle QUEUED -> RUNNING -> FAILED", async () => {
    const site = await createSeededSite();
    await createQueuedScan(db, {
      siteId: site.id,
      siteType: "OTHER",
      scannerVersion: "test-scanner"
    });

    const running = await claimNextQueuedScan(db, { useSkipLocked: false });
    const failed = await failScan(db, running!.id, "synthetic failure");

    expect(failed.status).toBe("FAILED");
    expect(failed.statusReason).toBe("synthetic failure");
  });

  it("allows multiple Scans for one Site and does not overwrite older Scans", async () => {
    const site = await createSeededSite();
    const first = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "B2B",
      scannerVersion: "test-scanner"
    });
    const running = await claimNextQueuedScan(db, { useSkipLocked: false });
    const completed = await completeScan(db, running!.id);
    const second = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "ECOMMERCE",
      scannerVersion: "test-scanner"
    });

    const scans = await getScansForSite(db, site.id);

    expect(scans).toHaveLength(2);
    expect(scans.map((scan) => scan.id)).toEqual([first.id, second.id]);
    expect(scans.find((scan) => scan.id === completed.id)?.status).toBe("COMPLETED");
    expect(scans.find((scan) => scan.id === second.id)?.status).toBe("QUEUED");
  });

  it("stores a Finding rule_id, rule_version, and Evidence relation through finding_evidence", async () => {
    const site = await createSeededSite();
    const scan = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "B2B",
      scannerVersion: "test-scanner"
    });
    const fact = await createFact(db, {
      scanId: scan.id,
      pageUrl: "https://example.test",
      factType: "synthetic_fact_found",
      value: { found: true }
    });
    const evidence = await createEvidence(db, {
      scanId: scan.id,
      factId: fact.id,
      evidenceType: "DOM_FRAGMENT",
      pageUrl: "https://example.test",
      payload: { selector: "form" }
    });
    const finding = await createFinding(db, {
      scanId: scan.id,
      ruleId: "TEST_SYNTHETIC_FORM_FACT_PRESENT",
      ruleVersion: "0.0.0-test",
      status: "PASS",
      severity: "LOW",
      confidence: 1,
      summary: "Synthetic test finding",
      explanation: "Synthetic finding for persistence test.",
      remediation: "No action.",
      evidenceIds: [evidence.id],
      missingContext: []
    });

    const evidenceIds = await getEvidenceIdsForFinding(db, finding.id);

    expect(finding.ruleId).toBe("TEST_SYNTHETIC_FORM_FACT_PRESENT");
    expect(finding.ruleVersion).toBe("0.0.0-test");
    expect(evidenceIds).toEqual([evidence.id]);
  });

  it("allows facts.page_url to be null", async () => {
    const site = await createSeededSite();
    const scan = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "OTHER",
      scannerVersion: "test-scanner"
    });
    const fact = await createFact(db, {
      scanId: scan.id,
      factType: "synthetic_context_fact",
      value: { source: "development" }
    });

    expect(fact.pageUrl).toBeUndefined();
  });
});
