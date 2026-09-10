import type { Queryable } from "@/db/client";
import { claimNextQueuedScan, getSiteById, markStaleRunningScansFailed } from "@/db/repository";
import { logger } from "@/logging";
import { runClaimedStaticExtractionScan } from "./scan-queue";

type WorkerOptions = {
  db: Queryable;
  idleDelayMs: number;
  staleRunningThresholdMs: number;
  runClaimedScan?: typeof runClaimedStaticExtractionScan;
  useSkipLocked?: boolean;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function claimAndRunNextScan(
  options: Pick<WorkerOptions, "db" | "runClaimedScan" | "useSkipLocked">
): Promise<Awaited<ReturnType<typeof runClaimedStaticExtractionScan>> | null> {
  const scan = await claimNextQueuedScan(options.db, { useSkipLocked: options.useSkipLocked });

  if (!scan) {
    return null;
  }

  const site = await getSiteById(options.db, scan.siteId);
  const startedAt = Date.now();

  logger.info("scan_status_transition", {
    scanId: scan.id,
    status: "RUNNING",
    domain: site?.normalizedDomain
  });

  const result = await (options.runClaimedScan ?? runClaimedStaticExtractionScan)(options.db, {
    scan,
    startUrl: site?.url ?? ""
  });

  logger.info("scan_status_transition", {
    scanId: result.scan.id,
    status: result.scan.status,
    domain: site?.normalizedDomain,
    durationMs: Date.now() - startedAt,
    pagesCrawled: result.crawlResult?.pages.length ?? 0,
    browserPagesAttempted: result.browserPagesAttempted,
    browserPagesCompleted: result.browserPagesCompleted,
    errorCategory: result.scan.status === "FAILED" ? result.scan.statusReason ?? "SCAN_FAILED" : undefined
  });

  return result;
}

export async function runScanWorker(options: WorkerOptions): Promise<void> {
  let stopping = false;
  const sleep = options.sleep ?? defaultSleep;

  const stop = () => {
    stopping = true;
  };

  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  const recovered = await markStaleRunningScansFailed(options.db, {
    olderThanMs: options.staleRunningThresholdMs
  });

  if (recovered > 0) {
    logger.warn("stale_scans_failed", { errorCategory: "STALE_RUNNING", pagesCrawled: recovered });
  }

  while (!stopping) {
    const result = await claimAndRunNextScan(options);

    if (!result) {
      await sleep(options.idleDelayMs);
      continue;
    }
  }
}
