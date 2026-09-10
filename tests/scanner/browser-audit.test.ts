import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Route } from "playwright-core";
import { newDb } from "pg-mem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Queryable } from "@/db/client";
import { createQueuedScan, createSite, upsertUser } from "@/db/repository";
import { persistStaticExtraction } from "@/facts/extractors/persistence";
import { extractStaticFacts } from "@/facts/extractors/static-html";
import type { StaticExtractionResult } from "@/facts/extractors/types";
import { runBrowserAudit } from "@/scanner/browser/audit";
import { findBrowserExecutable, launchBrowser } from "@/scanner/browser/browser-runtime";
import { selectBrowserAuditPages } from "@/scanner/browser/page-selection";
import type { CrawledPage } from "@/scanner/crawl/types";
import type { HostResolver } from "@/scanner/url-safety/resolver";

const resolver: HostResolver = {
  async lookup(hostname: string) {
    if (hostname === "127.0.0.1") {
      return [{ address: "127.0.0.1", family: 4 }];
    }
    return [{ address: "93.184.216.34", family: 4 }];
  }
};

function page(url: string, html = "<main></main>"): CrawledPage {
  return {
    url,
    status: 200,
    contentType: "text/html",
    title: "",
    html,
    internalLinks: [],
    externalLinks: [],
    documentLinks: []
  };
}

function factValues(result: StaticExtractionResult, factType: string) {
  return result.facts.filter((fact) => fact.factType === factType).map((fact) => fact.value);
}

function hasFact(result: StaticExtractionResult, factType: string) {
  return result.facts.some((fact) => fact.factType === factType);
}

function routeFromMap(routes: Record<string, string>) {
  return async (route: Route) => {
    const request = route.request();
    const url = request.url();

    if (routes[url]) {
      await route.fulfill({
        status: 200,
        contentType: url.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8",
        body: routes[url]
      });
      return;
    }

    await route.fulfill({ status: 204, body: "" });
  };
}

function createTestDb(): Queryable {
  const db = newDb();
  db.public.none(
    readFileSync(path.join(process.cwd(), "src", "db", "migrations", "001_initial_schema.sql"), "utf8")
  );
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

describe("targeted Playwright browser audit", () => {
  let browser: Browser;

  beforeAll(async () => {
    expect(findBrowserExecutable()).toBeTruthy();
    browser = await launchBrowser();
  }, 20_000);

  afterAll(async () => {
    await browser?.close();
  }, 60_000);

  it("detects dynamic forms, consent state, marketing consent, scripts, iframes, storage keys, cookies, and sanitized network hosts", async () => {
    const html = `
      <html><body>
        <script src="https://cdn.example.test/widget.js?token=secret-email@example.ru"></script>
        <iframe src="https://frame.example.test/frame?phone=79991234567"></iframe>
        <button>Войти через Yandex</button>
        <script>
          document.cookie = "session_id=secret-value; path=/; SameSite=Lax";
          localStorage.setItem("analytics_user_id", "123456");
          sessionStorage.setItem("checkout_phone", "+79991234567");
          fetch("/api/pixel", { method: "POST", body: "email=secret-email@example.ru", headers: { Authorization: "Bearer secret" } }).catch(() => {});
          fetch("https://analytics.example-cdn.test/collect?email=secret-email@example.ru").catch(() => {});
          const form = document.createElement("form");
          form.action = "/dynamic-lead";
          form.method = "post";
          form.innerHTML = '<label>Email <input type="email" name="email" required></label><label><input id="pd" type="checkbox"> Согласие на обработку персональных данных <a href="/privacy">policy</a></label><label><input id="ads" type="checkbox" checked> Согласие на рекламную рассылку</label>';
          document.body.appendChild(form);
        </script>
      </body></html>
    `;
    const pages = [page("https://example.test/", "<main>homepage</main>")];
    const staticExtraction = extractStaticFacts(pages, { crawlCompleted: true, startUrl: "https://example.test/" });

    const result = await runBrowserAudit(
      { pages, staticExtraction, startUrl: "https://example.test/" },
      {
        browser,
        resolver,
        config: { settleDelayMs: 300 },
        routeHandler: routeFromMap({
          "https://example.test/": html,
          "https://cdn.example.test/widget.js?token=secret-email@example.ru": "",
          "https://frame.example.test/frame?phone=79991234567": "<html></html>",
          "https://example.test/api/pixel": "",
          "https://analytics.example-cdn.test/collect?email=secret-email@example.ru": ""
        })
      }
    );

    expect(hasFact(result, "rendered_form_found")).toBe(true);
    expect(hasFact(result, "rendered_personal_data_collection_found")).toBe(true);
    expect(factValues(result, "rendered_consent_checked")).toContainEqual(
      expect.objectContaining({ checked: false })
    );
    expect(hasFact(result, "rendered_consent_text")).toBe(true);
    expect(hasFact(result, "rendered_marketing_consent_found")).toBe(true);
    expect(factValues(result, "rendered_marketing_consent_checked")).toContainEqual(
      expect.objectContaining({ checked: true })
    );
    expect(factValues(result, "rendered_form_action_target")).toContainEqual(
      expect.objectContaining({ actionUrl: "https://example.test/dynamic-lead" })
    );
    expect(factValues(result, "script_sources_rendered")[0]).toMatchObject({
      sources: [expect.objectContaining({ url: "https://cdn.example.test/widget.js?[redacted]" })]
    });
    expect(factValues(result, "iframe_sources_rendered")[0]).toMatchObject({
      sources: [expect.objectContaining({ url: "https://frame.example.test/frame?[redacted]" })]
    });
    expect(factValues(result, "local_storage_keys")[0]).toEqual({ keys: ["analytics_user_id"] });
    expect(factValues(result, "session_storage_keys")[0]).toEqual({ keys: ["checkout_phone"] });
    expect(JSON.stringify(factValues(result, "cookie_metadata"))).toContain("session_id");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("Authorization");
    expect(JSON.stringify(result)).not.toContain("secret-email@example.ru");
    expect(JSON.stringify(result)).not.toContain("79991234567");
    expect(factValues(result, "network_request_hosts")[0]).toMatchObject({
      requests: expect.arrayContaining([
        expect.objectContaining({ hostname: "example.test", relation: "FIRST_PARTY" }),
        expect.objectContaining({ hostname: "analytics.example-cdn.test", relation: "OTHER_HOST" })
      ])
    });
  }, 60_000);

  it("detects rendered auth provider candidates", async () => {
    const pages = [page("https://example.test/login")];
    const result = await runBrowserAudit(
      { pages, staticExtraction: { facts: [] }, startUrl: "https://example.test/login" },
      {
        browser,
        resolver,
        routeHandler: routeFromMap({
          "https://example.test/login": `<a href="https://id.example.test/oauth">Войти через Госуслуги</a>`
        })
      }
    );

    expect(factValues(result, "auth_provider_candidates_rendered")[0]).toMatchObject({
      candidates: [expect.objectContaining({ text: "Войти через Госуслуги", hostname: "id.example.test" })]
    });
  }, 20_000);

  it("detects preselected paid add-ons only on checkout-like pages", async () => {
    const pages = [page("https://shop.test/checkout")];
    const result = await runBrowserAudit(
      { pages, staticExtraction: { facts: [] }, startUrl: "https://shop.test/checkout" },
      {
        browser,
        resolver,
        routeHandler: routeFromMap({
          "https://shop.test/checkout": `
            <form>
              <label><input type="checkbox" checked> Дополнительная платная гарантия 990 ₽</label>
              <label><input type="checkbox"> Дополнительная страховка 490 ₽</label>
            </form>
          `
        })
      }
    );

    expect(factValues(result, "paid_addon_control_found")).toHaveLength(2);
    expect(factValues(result, "paid_addon_preselected")).toHaveLength(1);
  }, 20_000);

  it("blocks browser redirects to private/internal URLs and records partial browser failure", async () => {
    const pages = [page("https://example.test/")];
    const result = await runBrowserAudit(
      { pages, staticExtraction: { facts: [] }, startUrl: "https://example.test/" },
      {
        browser,
        resolver,
        config: { settleDelayMs: 100, navigationTimeoutMs: 1_000 },
        routeHandler: routeFromMap({
          "https://example.test/": `<script>location.href = "http://127.0.0.1/private"</script>`
        })
      }
    );

    expect(factValues(result, "browser_audit_coverage")[0]).toMatchObject({
      attempted: 1,
      completed: 0,
      failed: 1
    });
  }, 20_000);

  it("does not open out-of-scope pages", async () => {
    const pages = [page("https://other.test/form", "<form></form>")];
    const result = await runBrowserAudit(
      { pages, staticExtraction: { facts: [{ pageUrl: "https://other.test/form", factType: "form_found", value: { found: true }, evidence: [] }] }, startUrl: "https://example.test/" },
      {
        browser,
        resolver,
        config: { navigationTimeoutMs: 1_000 },
        routeHandler: routeFromMap({ "https://other.test/form": "<form></form>" })
      }
    );

    expect(factValues(result, "browser_audit_coverage")[0]).toMatchObject({ completed: 0, failed: 1 });
  }, 20_000);

  it("limits selected browser pages and deduplicates pages across priorities", () => {
    const pages = Array.from({ length: 12 }, (_value, index) =>
      page(`https://example.test/page-${index}`, index === 0 ? "<form></form>" : "")
    );
    const staticExtraction: StaticExtractionResult = {
      facts: pages.flatMap((item) => [
        { pageUrl: item.url, factType: "form_found", value: { found: true }, evidence: [] },
        { pageUrl: item.url, factType: "consent_control_found", value: { found: true }, evidence: [] }
      ])
    };

    const selected = selectBrowserAuditPages({
      pages,
      staticExtraction,
      startUrl: "https://example.test/page-0",
      config: { maxBrowserPages: 10 }
    });

    expect(selected).toHaveLength(10);
    expect(new Set(selected).size).toBe(10);
    expect(selected[0]).toBe("https://example.test/page-0");
  });

  it("closes browser context after each scan audit", async () => {
    const pages = [page("https://example.test/")];

    await runBrowserAudit(
      { pages, staticExtraction: { facts: [] }, startUrl: "https://example.test/" },
      {
        browser,
        resolver,
        routeHandler: routeFromMap({ "https://example.test/": "<main>ok</main>" })
      }
    );

    expect(browser.contexts()).toHaveLength(0);
  }, 20_000);

  it("sanitizes full email and phone from persisted static Facts and Evidence", async () => {
    const db = createTestDb();
    const user = await upsertUser(db, {
      id: "00000000-0000-4000-8000-000000000005",
      email: "task005@example.test"
    });
    const site = await createSite(db, {
      userId: user.id,
      url: "https://example.test",
      normalizedDomain: "example.test"
    });
    const scan = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "B2B",
      scannerVersion: "task005-test"
    });
    const extraction = extractStaticFacts(
      [
        page(
          "https://example.test/",
          `<footer>Контакты: sales@example.ru, телефон +7 (495) 123-45-67</footer><form><input value="secret@example.ru"></form>`
        )
      ],
      { crawlCompleted: true, startUrl: "https://example.test/" }
    );

    await persistStaticExtraction(db, scan.id, extraction);

    const facts = await db.query<{ value_json: unknown }>("select value_json from facts where scan_id = $1", [scan.id]);
    const evidence = await db.query<{ payload_json: unknown }>("select payload_json from evidence where scan_id = $1", [
      scan.id
    ]);
    const serialized = JSON.stringify({ facts: facts.rows, evidence: evidence.rows });

    expect(serialized).not.toContain("sales@example.ru");
    expect(serialized).not.toContain("secret@example.ru");
    expect(serialized).not.toContain("+7 (495) 123-45-67");
    expect(serialized).not.toContain("84951234567");
  });
});
