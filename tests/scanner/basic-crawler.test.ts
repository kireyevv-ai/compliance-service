import { readFileSync } from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@/db/client";
import {
  createQueuedScan,
  createSite,
  getScanById,
  upsertUser
} from "@/db/repository";
import { crawlSite } from "@/scanner/crawl/crawler";
import {
  createPinnedLookup,
  fetchPage,
  type FetchTransport,
  type FetchTransportResponse
} from "@/scanner/crawl/fetch";
import type { HostResolver } from "@/scanner/url-safety/resolver";
import { runCrawlerScanLifecycle } from "@/jobs/scan-queue";
import { getFactsForScan, getFindingsForScan } from "@/db/repository";
import { runStaticExtractionScanLifecycle } from "@/jobs/scan-queue";
import { coverageOutcomeForResult } from "@/app/results/presentation";

function createTestDb(): Queryable {
  const db = newDb();
  for (const file of [
    "001_initial_schema.sql",
    "002_owner_answers.sql",
    "003_owner_answer_context_key.sql",
    "004_findings_unique_rule_result.sql"
  ]) {
    db.public.none(readFileSync(path.join(process.cwd(), "src", "db", "migrations", file), "utf8"));
  }

  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

function publicResolver(hosts = ["example.test", "www.example.test"]): HostResolver {
  return {
    async lookup(hostname) {
      return hosts.includes(hostname.toLowerCase())
        ? [{ address: "93.184.216.34", family: 4 }]
        : [];
    }
  };
}

function transportFor(
  pages: Record<string, FetchTransportResponse>,
  visitedUrls: string[] = []
): FetchTransport {
  return async (url) => {
    visitedUrls.push(url.toString());
    const response = pages[url.toString()];

    if (!response) {
      return {
        status: 404,
        headers: { "content-type": "text/html" },
        body: "<html><title>Not found</title></html>"
      };
    }

    return response;
  };
}

const htmlHeaders = { "content-type": "text/html; charset=utf-8" };

describe("basic crawler", () => {
  it("crawls one HTML page", async () => {
    const result = await crawlSite("example.test", {
      resolver: publicResolver(),
      transport: transportFor({
        "https://example.test/": {
          status: 200,
          headers: htmlHeaders,
          body: "<html><head><title>Home</title></head><body></body></html>"
        }
      })
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].title).toBe("Home");
    expect(result.pages[0].html).toContain("<title>Home</title>");
  });

  it("crawls multiple internal pages", async () => {
    const result = await crawlSite("https://example.test", {
      resolver: publicResolver(),
      transport: transportFor({
        "https://example.test/": {
          status: 200,
          headers: htmlHeaders,
          body: '<html><title>Home</title><a href="/about">About</a></html>'
        },
        "https://example.test/about": {
          status: 200,
          headers: htmlHeaders,
          body: "<html><title>About</title></html>"
        }
      })
    });

    expect(result.pages.map((page) => page.title)).toEqual(["Home", "About"]);
  });

  it("does not crawl external links or sibling subdomains", async () => {
    const visitedUrls: string[] = [];
    const result = await crawlSite("https://shop.example.test", {
      resolver: publicResolver(["shop.example.test", "www.shop.example.test"]),
      transport: transportFor(
        {
          "https://shop.example.test/": {
            status: 200,
            headers: htmlHeaders,
            body:
              '<html><title>Shop</title><a href="https://api.example.test/x">API</a><a href="https://example.test/">Parent</a><a href="https://www.shop.example.test/page">WWW</a></html>'
          },
          "https://www.shop.example.test/page": {
            status: 200,
            headers: htmlHeaders,
            body: "<html><title>WWW page</title></html>"
          }
        },
        visitedUrls
      )
    });

    expect(result.pages.map((page) => page.url)).toEqual([
      "https://shop.example.test/",
      "https://www.shop.example.test/page"
    ]);
    expect(result.pages[0].externalLinks).toContain("https://api.example.test/x");
    expect(result.pages[0].externalLinks).toContain("https://example.test/");
    expect(visitedUrls).not.toContain("https://api.example.test/x");
    expect(visitedUrls).not.toContain("https://example.test/");
  });

  it("respects the page limit", async () => {
    const pages: Record<string, FetchTransportResponse> = {
      "https://example.test/": {
        status: 200,
        headers: htmlHeaders,
        body: Array.from({ length: 40 }, (_, index) => `<a href="/p${index}">p${index}</a>`).join("")
      }
    };

    for (let index = 0; index < 40; index += 1) {
      pages[`https://example.test/p${index}`] = {
        status: 200,
        headers: htmlHeaders,
        body: `<html><title>Page ${index}</title></html>`
      };
    }

    const result = await crawlSite("https://example.test", {
      config: { maxPages: 5 },
      resolver: publicResolver(),
      transport: transportFor(pages)
    });

    expect(result.pages).toHaveLength(5);
    expect(result.maxPagesReached).toBe(true);
  });

  it("respects the redirect limit", async () => {
    const transport: FetchTransport = async (url) => ({
      status: 302,
      headers: { location: `https://example.test/${url.pathname.replace("/", "")}x` },
      body: ""
    });

    await expect(
      fetchPage("https://example.test", { ...defaultFastConfig(), maxRedirects: 1 }, {
        resolver: publicResolver(),
        transport
      })
    ).rejects.toThrow("Too many redirects");
  });

  it("returns a pinned address in single-address and all-address lookup modes", async () => {
    const lookup = createPinnedLookup({ address: "93.184.216.34", family: 4 });

    const single = await new Promise((resolve, reject) => {
      lookup("example.test", {}, (error, address, family) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ address: String(address), family });
      });
    });
    const all = await new Promise((resolve, reject) => {
      lookup("example.test", { all: true }, (error: Error | null, addresses: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(addresses);
      });
    });

    expect(single).toEqual({ address: "93.184.216.34", family: 4 });
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("does not store binary content as HTML", async () => {
    const result = await crawlSite("https://example.test/file.png", {
      resolver: publicResolver(),
      transport: transportFor({
        "https://example.test/file.png": {
          status: 200,
          headers: { "content-type": "image/png" },
          body: "not really an image"
        }
      })
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].html).toBe("");
  });

  it("records document links but does not download documents", async () => {
    const visitedUrls: string[] = [];
    const result = await crawlSite("https://example.test", {
      resolver: publicResolver(),
      transport: transportFor(
        {
          "https://example.test/": {
            status: 200,
            headers: htmlHeaders,
            body: '<html><title>Home</title><a href="/policy.pdf">Policy</a><a href="/offer.docx">Offer</a></html>'
          }
        },
        visitedUrls
      )
    });

    expect(result.documentLinks.map((link) => link.url)).toEqual([
      "https://example.test/policy.pdf",
      "https://example.test/offer.docx"
    ]);
    expect(visitedUrls).toEqual(["https://example.test/"]);
  });

  it("does not loop forever on cyclic links", async () => {
    const result = await crawlSite("https://example.test", {
      resolver: publicResolver(),
      transport: transportFor({
        "https://example.test/": {
          status: 200,
          headers: htmlHeaders,
          body: '<html><title>Home</title><a href="/second">Second</a></html>'
        },
        "https://example.test/second": {
          status: 200,
          headers: htmlHeaders,
          body: '<html><title>Second</title><a href="/">Home</a></html>'
        }
      })
    });

    expect(result.pages.map((page) => page.title)).toEqual(["Home", "Second"]);
  });

  it("marks Scan COMPLETED after a successful crawler run", async () => {
    const db = createTestDb();
    const user = await upsertUser(db, { email: "dev@example.test" });
    const site = await createSite(db, {
      userId: user.id,
      url: "https://example.test",
      normalizedDomain: "example.test"
    });
    await createQueuedScan(db, {
      siteId: site.id,
      siteType: "B2B",
      scannerVersion: "crawler-test"
    });

    const result = await runCrawlerScanLifecycle(db, {
      startUrl: "https://example.test",
      useSkipLocked: false,
      crawlOptions: {
        resolver: publicResolver(),
        transport: transportFor({
          "https://example.test/": {
            status: 200,
            headers: htmlHeaders,
            body: "<html><title>Home</title></html>"
          }
        })
      }
    });

    expect(result?.scan.status).toBe("COMPLETED");
    expect(result?.crawlResult?.pages).toHaveLength(1);
  });

  it("keeps a Scan COMPLETED when an internal page response body is too large", async () => {
    const db = createTestDb();
    const user = await upsertUser(db, { email: "dev@example.test" });
    const site = await createSite(db, {
      userId: user.id,
      url: "https://example.test",
      normalizedDomain: "example.test"
    });
    await createQueuedScan(db, {
      siteId: site.id,
      siteType: "ECOMMERCE",
      scannerVersion: "crawler-test"
    });

    const result = await runStaticExtractionScanLifecycle(db, {
      startUrl: "https://example.test",
      useSkipLocked: false,
      browserAuditOptions: false,
      externalServiceDetectionOptions: false,
      crawlOptions: {
        resolver: publicResolver(),
        transport: transportFor({
          "https://example.test/": {
            status: 200,
            headers: htmlHeaders,
            body: '<html><title>Shop</title><a href="/huge">Huge category</a><p>Цена 1 000 ₽</p></html>'
          },
          "https://example.test/huge": {
            status: 200,
            headers: { ...htmlHeaders, "content-length": "1500000" },
            body: "",
            bodyLimited: true,
            limitationReason: "RESPONSE_BODY_TOO_LARGE",
            bodyBytes: 1_050_000,
            maxBodyBytes: 1_000_000
          }
        })
      }
    });

    expect(result?.scan.status).toBe("COMPLETED");
    expect(result?.crawlResult?.pages).toHaveLength(2);
    expect(result?.crawlResult?.pages[1]).toMatchObject({
      url: "https://example.test/huge",
      html: "",
      contentLimited: true,
      limitationReason: "RESPONSE_BODY_TOO_LARGE",
      responseBodyBytes: 1_050_000,
      responseBodyLimitBytes: 1_000_000,
      declaredContentLength: 1_500_000
    });

    const facts = await getFactsForScan(db, result!.scan.id);
    const coverage = facts.find((fact) => fact.factType === "scan_coverage");
    expect(coverage?.value).toMatchObject({
      contentLimited: true,
      limitationReason: "RESPONSE_BODY_TOO_LARGE",
      limitedPages: [
        expect.objectContaining({
          url: "https://example.test/huge",
          reason: "RESPONSE_BODY_TOO_LARGE",
          responseBodyBytes: 1_050_000,
          responseBodyLimitBytes: 1_000_000,
          declaredContentLength: 1_500_000
        })
      ]
    });
    expect(facts.some((fact) => fact.factType === "offer_link_found" && fact.value.found === false)).toBe(false);

    const findings = await getFindingsForScan(db, result!.scan.id);
    expect(findings.some((finding) => finding.ruleId === "EC-001" && finding.status === "FAIL")).toBe(false);
  });

  it("marks Scan FAILED with a safe reason after a controlled timeout", async () => {
    const db = createTestDb();
    const user = await upsertUser(db, { email: "dev@example.test" });
    const site = await createSite(db, {
      userId: user.id,
      url: "https://example.test",
      normalizedDomain: "example.test"
    });
    await createQueuedScan(db, {
      siteId: site.id,
      siteType: "OTHER",
      scannerVersion: "crawler-test"
    });

    const result = await runCrawlerScanLifecycle(db, {
      startUrl: "https://example.test",
      useSkipLocked: false,
      crawlOptions: {
        resolver: publicResolver(),
        transport: async () => {
          throw new Error("HTTP request timeout");
        }
      }
    });

    expect(result?.scan.status).toBe("FAILED");
    expect(result?.scan.statusReason).toBe("HTTP request timeout");
    expect(result?.crawlResult).toBeNull();
  });

  it("fails a Scan instead of hanging when a page request never settles", async () => {
    const db = createTestDb();
    const user = await upsertUser(db, { email: "dev@example.test" });
    const site = await createSite(db, {
      userId: user.id,
      url: "https://example.test",
      normalizedDomain: "example.test"
    });
    await createQueuedScan(db, {
      siteId: site.id,
      siteType: "OTHER",
      scannerVersion: "crawler-test"
    });

    const result = await runCrawlerScanLifecycle(db, {
      startUrl: "https://example.test",
      useSkipLocked: false,
      crawlOptions: {
        config: { requestTimeoutMs: 10, totalTimeoutMs: 1_000 },
        resolver: publicResolver(),
        transport: async () => new Promise<FetchTransportResponse>(() => undefined)
      }
    });

    expect(result?.scan.status).toBe("FAILED");
    expect(result?.scan.statusReason).toBe("HTTP request timeout");
    expect(result?.crawlResult).toBeNull();
  });

  it("ends a static scan when the first request outlives the scan budget", async () => {
    const db = createTestDb();
    const user = await upsertUser(db, { email: "dev@example.test" });
    const site = await createSite(db, {
      userId: user.id,
      url: "https://example.test",
      normalizedDomain: "example.test"
    });
    const scan = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "OTHER",
      scannerVersion: "crawler-test"
    });
    let aborted = false;

    const result = await runStaticExtractionScanLifecycle(db, {
      scanId: scan.id,
      startUrl: "https://example.test",
      scanTotalTimeoutMs: 25,
      browserAuditOptions: false,
      externalServiceDetectionOptions: false,
      crawlOptions: {
        config: { requestTimeoutMs: 1_000, totalTimeoutMs: 1_000 },
        resolver: publicResolver(),
        transport: (_url, _address, _config, signal) =>
          new Promise<FetchTransportResponse>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              aborted = true;
              reject(signal.reason);
            });
          })
      }
    });
    const stored = await getScanById(db, scan.id);

    expect(aborted).toBe(true);
    expect(result?.scan.status).toBe("FAILED");
    expect(result?.scan.statusReason).toBe("SCAN_TOTAL_TIMEOUT");
    expect(stored?.status).toBe("FAILED");
    expect(result?.crawlResult).toBeNull();
    expect(await getFindingsForScan(db, scan.id)).toHaveLength(0);
  });

  it("uses the scan-level deadline during browser audit with zero usable static coverage", async () => {
    const previousTimeout = process.env.SCAN_TOTAL_TIMEOUT_MS;
    process.env.SCAN_TOTAL_TIMEOUT_MS = "80";
    const db = createTestDb();
    const user = await upsertUser(db, { email: "dev@example.test" });
    const site = await createSite(db, {
      userId: user.id,
      url: "https://example.test",
      normalizedDomain: "example.test"
    });
    const scan = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "B2B",
      scannerVersion: "crawler-test"
    });
    const fakeBrowser = createHangingBrowser();

    try {
      const result = await runStaticExtractionScanLifecycle(db, {
        scanId: scan.id,
        startUrl: "https://example.test",
        externalServiceDetectionOptions: false,
        crawlOptions: {
          config: { requestTimeoutMs: 1_000, totalTimeoutMs: 1_000 },
          resolver: publicResolver(),
          transport: transportFor({
            "https://example.test/": {
              status: 200,
              headers: htmlHeaders,
              body: ""
            }
          })
        },
        browserAuditOptions: {
          browser: fakeBrowser.browser,
          config: { maxBrowserPages: 1, navigationTimeoutMs: 1_000, totalBrowserAuditTimeoutMs: 1_000 },
          resolver: publicResolver(),
          routeHandler: () => new Promise(() => undefined)
        }
      });
      const stored = await getScanById(db, scan.id);
      const facts = await getFactsForScan(db, scan.id);
      const coverage = facts.find((fact) => fact.factType === "scan_coverage");
      const findings = await getFindingsForScan(db, scan.id);
      const outcome = coverageOutcomeForResult({
        scanStatus: result?.scan.status ?? "FAILED",
        statusReason: result?.scan.statusReason ?? null,
        coverage: coverage?.value
      });

      expect(result?.scan.status).toBe("COMPLETED");
      expect(stored?.status).not.toBe("RUNNING");
      expect(coverage?.value).toMatchObject({
        successfulHtmlPages: 0,
        contentLimited: true,
        limitationReason: "SCAN_TOTAL_TIMEOUT",
        maxPagesReached: true
      });
      expect(outcome.kind).toBe("NETWORK_UNAVAILABLE");
      expect(outcome.blocksResults).toBe(true);
      expect(findings).toHaveLength(0);
      expect(fakeBrowser.closedContexts()).toBe(1);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.SCAN_TOTAL_TIMEOUT_MS;
      } else {
        process.env.SCAN_TOTAL_TIMEOUT_MS = previousTimeout;
      }
    }
  }, 20_000);

  it("keeps a partial terminal result when the scan budget expires after static pages were read", async () => {
    const previousTimeout = process.env.SCAN_TOTAL_TIMEOUT_MS;
    process.env.SCAN_TOTAL_TIMEOUT_MS = "80";
    const db = createTestDb();
    const user = await upsertUser(db, { email: "dev@example.test" });
    const site = await createSite(db, {
      userId: user.id,
      url: "https://example.test",
      normalizedDomain: "example.test"
    });
    const scan = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "B2B",
      scannerVersion: "crawler-test"
    });
    const fakeBrowser = createHangingBrowser();

    try {
      const result = await runStaticExtractionScanLifecycle(db, {
        scanId: scan.id,
        startUrl: "https://example.test",
        externalServiceDetectionOptions: false,
        crawlOptions: {
          config: { requestTimeoutMs: 500, totalTimeoutMs: 500 },
          resolver: publicResolver(),
          transport: transportFor({
            "https://example.test/": {
              status: 200,
              headers: htmlHeaders,
              body: "<html><body><form><input name=\"email\"></form></body></html>"
            }
          })
        },
        browserAuditOptions: {
          browser: fakeBrowser.browser,
          config: { maxBrowserPages: 1, navigationTimeoutMs: 1_000, totalBrowserAuditTimeoutMs: 1_000 },
          resolver: publicResolver(),
          routeHandler: () => new Promise(() => undefined)
        }
      });
      const stored = await getScanById(db, scan.id);
      const coverage = (await getFactsForScan(db, scan.id)).find((fact) => fact.factType === "scan_coverage");
      const findings = await getFindingsForScan(db, scan.id);

      expect(result?.scan.status).toBe("COMPLETED");
      expect(stored?.status).not.toBe("RUNNING");
      expect(result?.crawlResult?.pages).toHaveLength(1);
      expect(coverage?.value).toMatchObject({
        successfulHtmlPages: 1,
        maxPagesReached: true,
        limitationReason: "SCAN_TOTAL_TIMEOUT"
      });
      expect(findings.some((finding) => finding.status === "PASS" || finding.status === "FAIL")).toBe(false);
      expect(fakeBrowser.closedContexts()).toBe(1);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.SCAN_TOTAL_TIMEOUT_MS;
      } else {
        process.env.SCAN_TOTAL_TIMEOUT_MS = previousTimeout;
      }
    }
  }, 20_000);
});

function createHangingBrowser() {
  let closedContextCount = 0;
  const contexts: Array<{ closed: boolean; close: () => Promise<void> }> = [];
  const browser = {
    async newContext() {
      const pages: Array<{ close: () => Promise<void>; failNavigation: () => void }> = [];
      const context = {
        closed: false,
        async newPage() {
          let routeHandler: ((route: unknown) => Promise<void>) | undefined;
          let rejectNavigation: ((error: Error) => void) | undefined;
          const page = {
            on() {
              return undefined;
            },
            async route(_pattern: string, handler: (route: unknown) => Promise<void>) {
              routeHandler = handler;
            },
            async goto() {
              return new Promise((_resolve, reject) => {
                rejectNavigation = reject;
                void routeHandler?.({
                  request: () => ({
                    url: () => "https://example.test/",
                    isNavigationRequest: () => true,
                    resourceType: () => "document"
                  }),
                  abort: async () => reject(new Error("blockedbyclient")),
                  continue: async () => undefined
                });
              });
            },
            url() {
              return "https://example.test/";
            },
            async waitForTimeout() {
              return undefined;
            },
            async evaluate() {
              return {};
            },
            async close() {
              rejectNavigation?.(new Error("page closed"));
            },
            failNavigation() {
              rejectNavigation?.(new Error("context closed"));
            }
          };
          pages.push(page);
          return page;
        },
        async close() {
          if (!context.closed) {
            context.closed = true;
            closedContextCount += 1;
            for (const page of pages) {
              page.failNavigation();
            }
          }
        }
      };
      contexts.push(context);
      return context;
    },
    contexts() {
      return contexts.filter((context) => !context.closed);
    },
    async close() {
      await Promise.all(contexts.map((context) => context.close()));
    }
  };

  return {
    browser: browser as never,
    closedContexts: () => closedContextCount
  };
}

function defaultFastConfig() {
  return {
    maxPages: 30,
    requestTimeoutMs: 100,
    totalTimeoutMs: 1_000,
    maxResponseBodyBytes: 100_000,
    maxRedirects: 5,
    concurrency: 2
  };
}
