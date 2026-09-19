import type { Queryable } from "@/db/client";
import {
  claimNextQueuedScan,
  claimQueuedScanById,
  completeScan,
  failScan,
  getEvidenceForScan,
  getFactsForScan
} from "@/db/repository";
import { detectExternalServices, type ExternalServiceDetectionConfig } from "@/external-services/detection";
import { persistProductionFindings } from "@/findings/integration";
import { deriveRuntimeFacts } from "@/facts/derived";
import { extractStaticFacts } from "@/facts/extractors/static-html";
import { persistStaticExtraction } from "@/facts/extractors/persistence";
import type { Scan } from "@/db/schema";
import { runBrowserAudit, type BrowserAuditOptions } from "@/scanner/browser/audit";
import { crawlSite, type CrawlOptions } from "@/scanner/crawl/crawler";
import type { CrawlResult } from "@/scanner/crawl/types";
import { sanitizeScanFailureReason } from "@/scanner/url-safety/url-safety";
import type { SemanticShadowEvaluation } from "@/semantic-evaluator/shadow";
import {
  createScanDeadline,
  isScanDeadlineExceeded,
  SCAN_TOTAL_TIMEOUT_REASON,
  type ScanDeadline
} from "@/jobs/scan-deadline";

export type StaticExtractionScanResult =
  | {
      scan: Scan;
      crawlResult: CrawlResult;
      factCount: number;
      evidenceCount: number;
      browserPagesAttempted: number;
      browserPagesCompleted: number;
      semanticShadowResults?: SemanticShadowEvaluation[];
    }
  | {
      scan: Scan;
      crawlResult: null;
      factCount: 0;
      evidenceCount: 0;
      browserPagesAttempted: 0;
      browserPagesCompleted: 0;
      semanticShadowResults?: [];
    };

export async function runNoOpScanLifecycle(
  db: Queryable,
  options: { failWithReason?: string; useSkipLocked?: boolean } = {}
): Promise<Scan | null> {
  const scan = await claimNextQueuedScan(db, { useSkipLocked: options.useSkipLocked });

  if (!scan) {
    return null;
  }

  if (options.failWithReason) {
    return failScan(db, scan.id, options.failWithReason);
  }

  return completeScan(db, scan.id);
}

export async function runCrawlerScanLifecycle(
  db: Queryable,
  input: { startUrl: string; crawlOptions?: CrawlOptions; useSkipLocked?: boolean }
): Promise<{ scan: Scan; crawlResult: CrawlResult } | { scan: Scan; crawlResult: null } | null> {
  const scan = await claimNextQueuedScan(db, { useSkipLocked: input.useSkipLocked });

  if (!scan) {
    return null;
  }

  try {
    const crawlResult = await crawlSite(input.startUrl, input.crawlOptions);
    const completed = await completeScan(db, scan.id);
    return { scan: completed, crawlResult };
  } catch (error) {
    const failed = await failScan(db, scan.id, sanitizeScanFailureReason(error));
    return { scan: failed, crawlResult: null };
  }
}

export async function runStaticExtractionScanLifecycle(
  db: Queryable,
  input: {
    startUrl: string;
    crawlOptions?: CrawlOptions;
    browserAuditOptions?: BrowserAuditOptions | false;
    externalServiceDetectionOptions?: { config?: Partial<ExternalServiceDetectionConfig> } | false;
    scanId?: string;
    scanTotalTimeoutMs?: number;
    useSkipLocked?: boolean;
  }
): Promise<StaticExtractionScanResult | null> {
  const scan = input.scanId
    ? await claimQueuedScanById(db, input.scanId)
    : await claimNextQueuedScan(db, { useSkipLocked: input.useSkipLocked });

  if (!scan) {
    return null;
  }

  return runClaimedStaticExtractionScan(db, {
    scan,
    startUrl: input.startUrl,
    crawlOptions: input.crawlOptions,
    browserAuditOptions: input.browserAuditOptions,
    externalServiceDetectionOptions: input.externalServiceDetectionOptions,
    scanTotalTimeoutMs: input.scanTotalTimeoutMs
  });
}

export async function runClaimedStaticExtractionScan(
  db: Queryable,
  input: {
    scan: Scan;
    startUrl: string;
    crawlOptions?: CrawlOptions;
    browserAuditOptions?: BrowserAuditOptions | false;
    externalServiceDetectionOptions?: { config?: Partial<ExternalServiceDetectionConfig> } | false;
    scanTotalTimeoutMs?: number;
  }
): Promise<StaticExtractionScanResult> {
  const scan = input.scan;
  const deadline = createScanDeadline(input.scanTotalTimeoutMs);
  let crawlResult: CrawlResult | null = null;

  try {
    deadline.throwIfExpired();
    crawlResult = await crawlSite(input.startUrl, withDeadlineCrawlOptions(input.crawlOptions, deadline));
    deadline.throwIfExpired();
    const extraction = extractStaticFacts(crawlResult.pages, {
      crawlCompleted: true,
      startUrl: crawlResult.startUrl,
      maxPagesReached:
        crawlResult.maxPagesReached === true ||
        input.crawlOptions?.config?.maxPages !== undefined &&
        crawlResult.pages.length >= input.crawlOptions.config.maxPages
    });
    const browserExtraction =
      input.browserAuditOptions === false
        ? { facts: [] }
        : await runBrowserAudit(
            {
              pages: crawlResult.pages,
              staticExtraction: extraction,
              startUrl: crawlResult.startUrl
            },
            withDeadlineBrowserOptions(input.browserAuditOptions, deadline)
          );
    deadline.throwIfExpired();
    const browserCoverage = browserExtraction.facts.find((fact) => fact.factType === "browser_audit_coverage");
    const browserCoverageValue = browserCoverage?.value as
      | { attempted?: unknown; completed?: unknown }
      | undefined;
    const externalServiceExtraction =
      input.externalServiceDetectionOptions === false
        ? { facts: [] }
        : detectExternalServices({
            facts: [...extraction.facts, ...browserExtraction.facts],
            startUrl: crawlResult.startUrl,
            config: input.externalServiceDetectionOptions?.config
          });
    const derivedFacts = deriveRuntimeFacts({
      facts: [...extraction.facts, ...browserExtraction.facts, ...externalServiceExtraction.facts],
      pages: crawlResult.pages,
      startUrl: crawlResult.startUrl,
      siteType: scan.siteType
    });
    const persisted = await persistStaticExtraction(db, scan.id, {
      facts: [...extraction.facts, ...browserExtraction.facts, ...externalServiceExtraction.facts, ...derivedFacts]
    });
    const facts = await getFactsForScan(db, scan.id);
    const evidence = await getEvidenceForScan(db, scan.id);
    deadline.throwIfExpired();
    const persistedEvaluations = await persistProductionFindings(db, {
      scan,
      facts,
      evidence
    });

    const completed = await completeScan(db, scan.id);
    return {
      scan: completed,
      crawlResult,
      ...persisted,
      browserPagesAttempted: Number(browserCoverageValue?.attempted ?? 0),
      browserPagesCompleted: Number(browserCoverageValue?.completed ?? 0),
      semanticShadowResults: []
    };
  } catch (error) {
    if (isScanDeadlineExceeded(error)) {
      if (crawlResult && crawlResult.pages.length > 0) {
        return persistPartialTimeoutResult(db, {
          scan,
          crawlResult,
          crawlOptions: input.crawlOptions
        });
      }

      const failed = await failScan(db, scan.id, SCAN_TOTAL_TIMEOUT_REASON);
      return {
        scan: failed,
        crawlResult: null,
        factCount: 0,
        evidenceCount: 0,
        browserPagesAttempted: 0,
        browserPagesCompleted: 0,
        semanticShadowResults: []
      };
    }

    const failed = await failScan(db, scan.id, sanitizeScanFailureReason(error));
    return {
      scan: failed,
      crawlResult: null,
      factCount: 0,
      evidenceCount: 0,
      browserPagesAttempted: 0,
      browserPagesCompleted: 0,
      semanticShadowResults: []
    };
  } finally {
    deadline.dispose();
  }
}

async function persistPartialTimeoutResult(
  db: Queryable,
  input: {
    scan: Scan;
    crawlResult: CrawlResult;
    crawlOptions?: CrawlOptions;
  }
): Promise<StaticExtractionScanResult> {
  const extraction = extractStaticFacts(input.crawlResult.pages, {
    crawlCompleted: true,
    startUrl: input.crawlResult.startUrl,
    maxPagesReached: true,
    scanLimitationReason: SCAN_TOTAL_TIMEOUT_REASON
  });
  const derivedFacts = deriveRuntimeFacts({
    facts: extraction.facts,
    pages: input.crawlResult.pages,
    startUrl: input.crawlResult.startUrl,
    siteType: input.scan.siteType
  });
  const persisted = await persistStaticExtraction(db, input.scan.id, {
    facts: [...extraction.facts, ...derivedFacts]
  });
  const facts = await getFactsForScan(db, input.scan.id);
  const evidence = await getEvidenceForScan(db, input.scan.id);
  await persistProductionFindings(db, {
    scan: input.scan,
    facts,
    evidence,
    semanticProvider: undefined
  });

  const completed = await completeScan(db, input.scan.id);
  return {
    scan: completed,
    crawlResult: input.crawlResult,
    ...persisted,
    browserPagesAttempted: 0,
    browserPagesCompleted: 0,
    semanticShadowResults: []
  };
}

function withDeadlineCrawlOptions(options: CrawlOptions | undefined, deadline: ScanDeadline): CrawlOptions {
  const remaining = Math.max(1, deadline.remainingMs());
  const config = {
    ...options?.config,
    requestTimeoutMs: Math.min(options?.config?.requestTimeoutMs ?? remaining, remaining),
    totalTimeoutMs: Math.min(options?.config?.totalTimeoutMs ?? remaining, remaining)
  };
  return {
    ...options,
    config,
    signal: deadline.signal
  };
}

function withDeadlineBrowserOptions(options: BrowserAuditOptions | false | undefined, deadline: ScanDeadline): BrowserAuditOptions {
  const base = options === false ? undefined : options;
  const remaining = Math.max(1, deadline.remainingMs());
  return {
    ...base,
    config: {
      ...base?.config,
      navigationTimeoutMs: Math.min(base?.config?.navigationTimeoutMs ?? remaining, remaining),
      totalBrowserAuditTimeoutMs: Math.min(base?.config?.totalBrowserAuditTimeoutMs ?? remaining, remaining)
    },
    signal: deadline.signal
  };
}
