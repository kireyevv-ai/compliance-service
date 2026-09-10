import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Route } from "playwright-core";
import { newDb } from "pg-mem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Queryable } from "@/db/client";
import {
  createQueuedScan,
  createSite,
  getEvidenceForScan,
  getFactsForScan,
  getFindingsForScan,
  upsertUser
} from "@/db/repository";
import { runStaticExtractionScanLifecycle } from "@/jobs/scan-queue";
import { findBrowserExecutable, launchBrowser } from "@/scanner/browser/browser-runtime";
import type { FetchTransport, FetchTransportResponse } from "@/scanner/crawl/fetch";
import type { HostResolver } from "@/scanner/url-safety/resolver";

const htmlHeaders = { "content-type": "text/html; charset=utf-8" };

const homeHtml = `
  <html>
    <head>
      <title>Demo shop</title>
      <script src="https://www.googletagmanager.com/gtag/js?id=G-SYNTHETIC"></script>
    </head>
    <body>
      <nav>
        <a href="/catalog">Каталог</a>
        <a href="/contacts">Контакты и реквизиты</a>
        <a href="/policy">Политика обработки персональных данных</a>
        <a href="/offer">Публичная оферта</a>
      </nav>
      <main>
        <h1>Demo shop</h1>
        <p>Товар для проверки: 1 990 ₽</p>
        <form action="/lead" method="post">
          <label>Имя <input name="name" autocomplete="name" required></label>
          <label>Телефон <input name="phone" autocomplete="tel" required></label>
          <label>
            <input type="checkbox" name="pd-consent">
            Согласие на обработку персональных данных, политика доступна по ссылке
            <a href="/policy">Политика обработки персональных данных</a>
          </label>
        </form>
        <script>
          window.addEventListener("load", () => {
            fetch("https://www.googletagmanager.com/collect?v=2").catch(() => {});
          });
        </script>
      </main>
    </body>
  </html>
`;

const contactsHtml = `
  <html>
    <body>
      <footer class="contacts requisites">
        Реквизиты продавца:
        ООО "Демо Маркет"
        ОГРН 1234567890123
        Юридический адрес: 109000, г. Москва, ул. Тестовая, д. 1
        E-mail: sales@example.ru
        Телефон +7 (495) 123-45-67
        Режим работы: понедельник-пятница 10:00-18:00
      </footer>
    </body>
  </html>
`;

const pages: Record<string, FetchTransportResponse> = {
  "https://shop.example.test/": { status: 200, headers: htmlHeaders, body: homeHtml },
  "https://shop.example.test/catalog": {
    status: 200,
    headers: htmlHeaders,
    body: '<html><body><a href="/">Главная</a><p>Еще один товар: 2 500 руб.</p></body></html>'
  },
  "https://shop.example.test/contacts": { status: 200, headers: htmlHeaders, body: contactsHtml },
  "https://shop.example.test/policy": {
    status: 200,
    headers: htmlHeaders,
    body: "<html><body><h1>Политика обработки персональных данных</h1></body></html>"
  },
  "https://shop.example.test/offer": {
    status: 200,
    headers: htmlHeaders,
    body: "<html><body><h1>Публичная оферта</h1></body></html>"
  }
};

const resolver: HostResolver = {
  async lookup(hostname) {
    return ["shop.example.test", "www.shop.example.test", "www.googletagmanager.com"].includes(
      hostname.toLowerCase()
    )
      ? [{ address: "93.184.216.34", family: 4 }]
      : [];
  }
};

const transport: FetchTransport = async (url) =>
  pages[url.toString()] ?? { status: 404, headers: htmlHeaders, body: "<html></html>" };

function createTestDb(): Queryable {
  const db = newDb();
  db.public.none(
    readFileSync(path.join(process.cwd(), "src", "db", "migrations", "001_initial_schema.sql"), "utf8")
  );
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

function routeFromFixture(route: Route) {
  const requestUrl = route.request().url();
  const page = pages[requestUrl];

  if (page) {
    return route.fulfill({
      status: page.status,
      contentType: "text/html; charset=utf-8",
      body: page.body
    });
  }

  if (requestUrl.startsWith("https://www.googletagmanager.com/")) {
    return route.fulfill({ status: 204, body: "" });
  }

  return route.fulfill({ status: 404, contentType: "text/html; charset=utf-8", body: "<html></html>" });
}

describe("synthetic E2E MVP pipeline", () => {
  let browser: Browser;

  beforeAll(async () => {
    expect(findBrowserExecutable()).toBeTruthy();
    browser = await launchBrowser();
  }, 20_000);

  afterAll(async () => {
    await browser?.close();
  }, 60_000);

  it("runs URL to facts, evidence, external services, rule engine, and findings", async () => {
    const db = createTestDb();
    const user = await upsertUser(db, { email: "synthetic-e2e@example.test" });
    const site = await createSite(db, {
      userId: user.id,
      url: "https://shop.example.test/",
      normalizedDomain: "shop.example.test"
    });
    const queuedScan = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "ECOMMERCE",
      scannerVersion: "synthetic-e2e-test"
    });

    const result = await runStaticExtractionScanLifecycle(db, {
      scanId: queuedScan.id,
      startUrl: "https://shop.example.test/",
      useSkipLocked: false,
      crawlOptions: { resolver, transport, config: { maxPages: 10 } },
      browserAuditOptions: {
        browser,
        resolver,
        config: { settleDelayMs: 150 },
        routeHandler: routeFromFixture
      }
    });

    expect(result?.scan.status).toBe("COMPLETED");
    expect(result?.crawlResult?.pages.map((page) => page.url)).toEqual([
      "https://shop.example.test/",
      "https://shop.example.test/catalog",
      "https://shop.example.test/contacts",
      "https://shop.example.test/policy",
      "https://shop.example.test/offer"
    ]);

    const facts = await getFactsForScan(db, queuedScan.id);
    const evidence = await getEvidenceForScan(db, queuedScan.id);
    const findings = await getFindingsForScan(db, queuedScan.id);
    const factTypes = new Set(facts.map((fact) => fact.factType));

    expect(factTypes.has("personal_data_collection_found")).toBe(true);
    expect(factTypes.has("rendered_personal_data_collection_found")).toBe(true);
    expect(factTypes.has("external_service_detected")).toBe(true);
    expect(factTypes.has("seller_legal_name_candidate")).toBe(true);
    expect(factTypes.has("ruble_price_found")).toBe(true);
    expect(evidence.length).toBeGreaterThan(0);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((finding) => finding.ruleId === "PD-001" && finding.status === "PASS")).toBe(true);
    expect(findings.some((finding) => finding.ruleId === "EC-001" && finding.status === "PASS")).toBe(true);
    expect(findings.some((finding) => finding.status === "FAIL")).toBe(false);
    expect(JSON.stringify({ facts, evidence })).not.toContain("sales@example.ru");
    expect(JSON.stringify({ facts, evidence })).not.toContain("+7 (495) 123-45-67");
  }, 30_000);
});
