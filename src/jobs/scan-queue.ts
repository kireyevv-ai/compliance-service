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
    externalServiceDetectionOptions: input.externalServiceDetectionOptions
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
  }
): Promise<StaticExtractionScanResult> {
  const scan = input.scan;

  try {
    const crawlResult = await crawlSite(input.startUrl, input.crawlOptions);
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
            input.browserAuditOptions
          );
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
  }
}
