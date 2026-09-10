import { readFileSync } from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import type { Queryable } from "@/db/client";
import {
  claimNextQueuedScan,
  completeScan,
  createQueuedScan,
  createSite,
  failScan,
  getScanById,
  markStaleRunningScansFailed,
  upsertUser
} from "@/db/repository";
import { claimAndRunNextScan } from "@/jobs/worker-loop";

function createTestDb(): Queryable {
  const db = newDb();
  db.public.none(
    readFileSync(path.join(process.cwd(), "src", "db", "migrations", "001_initial_schema.sql"), "utf8")
  );
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

async function createSeededScan(db: Queryable) {
  const user = await upsertUser(db, { email: "worker@example.test" });
  const site = await createSite(db, {
    userId: user.id,
    url: "https://example.test/",
    normalizedDomain: "example.test"
  });

  return createQueuedScan(db, {
    siteId: site.id,
    siteType: "B2B",
    scannerVersion: "worker-test"
  });
}

describe("scan worker foundation", () => {
  it("claims a queued Scan and runs the pipeline outside the HTTP route", async () => {
    const db = createTestDb();
    const queued = await createSeededScan(db);
    const result = await claimAndRunNextScan({
      db,
      useSkipLocked: false,
      runClaimedScan: async (queryable, input) => ({
        scan: await completeScan(queryable, input.scan.id),
        crawlResult: {
          startUrl: input.startUrl,
          normalizedDomain: "example.test",
          pages: [],
          documentLinks: []
        },
        factCount: 0,
        evidenceCount: 0,
        browserPagesAttempted: 0,
        browserPagesCompleted: 0
      })
    });

    expect(result?.scan.id).toBe(queued.id);
    expect(result?.scan.status).toBe("COMPLETED");
  });

  it("does not claim the same Scan twice", async () => {
    const db = createTestDb();
    await createSeededScan(db);

    const first = await claimNextQueuedScan(db, { useSkipLocked: false });
    const second = await claimNextQueuedScan(db, { useSkipLocked: false });

    expect(first?.status).toBe("RUNNING");
    expect(second).toBeNull();
  });

  it("marks stale RUNNING scans as FAILED on worker recovery", async () => {
    const db = createTestDb();
    const queued = await createSeededScan(db);
    const running = await claimNextQueuedScan(db, { useSkipLocked: false });

    await db.query("update scans set started_at = $1 where id = $2", [
      new Date(Date.now() - 60 * 60_000),
      running!.id
    ]);

    const recovered = await markStaleRunningScansFailed(db, {
      olderThanMs: 30 * 60_000,
      statusReason: "stale test"
    });
    const scan = await getScanById(db, queued.id);

    expect(recovered).toBe(1);
    expect(scan?.status).toBe("FAILED");
    expect(scan?.statusReason).toBe("stale test");
  });

  it("turns worker pipeline failures into FAILED scans", async () => {
    const db = createTestDb();
    const queued = await createSeededScan(db);
    const result = await claimAndRunNextScan({
      db,
      useSkipLocked: false,
      runClaimedScan: async (queryable, input) => ({
        scan: await failScan(queryable, input.scan.id, "synthetic worker failure"),
        crawlResult: null,
        factCount: 0,
        evidenceCount: 0,
        browserPagesAttempted: 0,
        browserPagesCompleted: 0
      })
    });

    expect(result?.scan.id).toBe(queued.id);
    expect(result?.scan.status).toBe("FAILED");
    expect(result?.scan.statusReason).toBe("synthetic worker failure");
  });
});
