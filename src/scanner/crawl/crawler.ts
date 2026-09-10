import { DEFAULT_CRAWL_CONFIG, type CrawlConfig } from "./config";
import { fetchPage, type FetchTransport } from "./fetch";
import {
  extractHrefValues,
  extractTitle,
  isDocumentUrl,
  isHtmlContentType,
  shouldSkipAsPage
} from "./html";
import type { CrawlDocumentLink, CrawledPage, CrawlResult } from "./types";
import { normalizeUserUrl, type NormalizedUrl } from "@/scanner/normalization/url";
import { dnsHostResolver, type HostResolver } from "@/scanner/url-safety/resolver";

export interface CrawlOptions {
  config?: Partial<CrawlConfig>;
  resolver?: HostResolver;
  transport?: FetchTransport;
}

export async function crawlSite(inputUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const normalized = normalizeUserUrl(inputUrl);
  const config: CrawlConfig = { ...DEFAULT_CRAWL_CONFIG, ...options.config };
  const deadline = Date.now() + config.totalTimeoutMs;
  const queue = [normalized.canonicalStartUrl];
  const queued = new Set(queue.map(normalizeForVisitKey));
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const documentLinks = new Map<string, CrawlDocumentLink>();
  let maxPagesReached = false;

  while (queue.length > 0 && pages.length < config.maxPages) {
    if (Date.now() > deadline) {
      throw new Error("Total crawl timeout");
    }

    const batch = queue.splice(0, Math.max(1, Math.min(config.concurrency, config.maxPages - pages.length)));
    const batchResults = await Promise.all(
      batch.map((url) =>
        withPageTimeout(
          crawlOnePage(url, normalized, config, {
            resolver: options.resolver ?? dnsHostResolver,
            transport: options.transport
          }),
          config.requestTimeoutMs + 1_000
        )
      )
    );

    for (const page of batchResults) {
      const visitKey = normalizeForVisitKey(page.url);
      if (visited.has(visitKey)) {
        continue;
      }

      visited.add(visitKey);

      for (const documentLink of page.documentLinks) {
        documentLinks.set(documentLink.url, documentLink);
      }

      pages.push(page);

      for (const link of page.internalLinks) {
        const linkKey = normalizeForVisitKey(link);

        if (visited.has(linkKey) || queued.has(linkKey)) {
          continue;
        }

        if (queue.length + pages.length >= config.maxPages) {
          maxPagesReached = true;
          continue;
        }

        queued.add(linkKey);
        queue.push(link);
      }
    }
  }

  return {
    startUrl: normalized.canonicalStartUrl,
    normalizedDomain: normalized.normalizedDomain,
    pages,
    documentLinks: Array.from(documentLinks.values()),
    maxPagesReached: maxPagesReached || (pages.length >= config.maxPages && queue.length > 0),
    pendingInternalUrls: queue.length
  };
}

async function crawlOnePage(
  url: string,
  normalized: NormalizedUrl,
  config: CrawlConfig,
  options: { resolver: HostResolver; transport?: FetchTransport }
): Promise<CrawledPage> {
  const response = await fetchPage(url, config, options);
  const finalUrl = new URL(response.url);
  const links = classifyLinks(response.body, finalUrl, normalized);

  if (response.bodyLimited) {
    return {
      url: response.url,
      status: response.status,
      contentType: response.contentType,
      title: "",
      html: "",
      contentLimited: true,
      limitationReason: response.limitationReason,
      responseBodyBytes: response.bodyBytes,
      responseBodyLimitBytes: response.maxBodyBytes,
      declaredContentLength: response.declaredContentLength,
      internalLinks: [],
      externalLinks: [],
      documentLinks: []
    };
  }

  if (!isHtmlContentType(response.contentType)) {
    return {
      url: response.url,
      status: response.status,
      contentType: response.contentType,
      title: "",
      html: "",
      internalLinks: [],
      externalLinks: links.externalLinks,
      documentLinks: links.documentLinks
    };
  }

  return {
    url: response.url,
    status: response.status,
    contentType: response.contentType,
    title: extractTitle(response.body),
    html: response.body,
    internalLinks: links.internalLinks,
    externalLinks: links.externalLinks,
    documentLinks: links.documentLinks
  };
}

function classifyLinks(
  html: string,
  baseUrl: URL,
  normalized: NormalizedUrl
): {
  internalLinks: string[];
  externalLinks: string[];
  documentLinks: CrawlDocumentLink[];
} {
  const internalLinks = new Set<string>();
  const externalLinks = new Set<string>();
  const documentLinks = new Map<string, CrawlDocumentLink>();

  for (const href of extractHrefValues(html)) {
    let link: URL;

    try {
      link = new URL(href, baseUrl);
    } catch {
      continue;
    }

    if (link.protocol !== "http:" && link.protocol !== "https:") {
      continue;
    }

    link.hash = "";
    const linkString = link.toString();

    if (isDocumentUrl(link)) {
      documentLinks.set(linkString, { url: linkString });
      continue;
    }

    if (isInCrawlScope(link, normalized) && !shouldSkipAsPage(link)) {
      internalLinks.add(linkString);
    } else {
      externalLinks.add(linkString);
    }
  }

  return {
    internalLinks: Array.from(internalLinks),
    externalLinks: Array.from(externalLinks),
    documentLinks: Array.from(documentLinks.values())
  };
}

function isInCrawlScope(url: URL, normalized: NormalizedUrl): boolean {
  return normalized.allowedHosts.includes(url.hostname.toLowerCase());
}

function normalizeForVisitKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

function withPageTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("HTTP request timeout"));
    }, timeoutMs);

    operation.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
