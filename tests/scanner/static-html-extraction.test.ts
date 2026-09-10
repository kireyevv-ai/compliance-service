import { readFileSync } from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@/db/client";
import { completeScan, createQueuedScan, createSite, upsertUser } from "@/db/repository";
import { extractStaticFacts } from "@/facts/extractors/static-html";
import { persistStaticExtraction } from "@/facts/extractors/persistence";
import type { ExtractedFact } from "@/facts/extractors/types";
import type { CrawledPage } from "@/scanner/crawl/types";

function page(url: string, html: string): CrawledPage {
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

function values(result: { facts: ExtractedFact[] }, factType: ExtractedFact["factType"]) {
  return result.facts.filter((fact) => fact.factType === factType).map((fact) => fact.value);
}

function hasFact(result: { facts: ExtractedFact[] }, factType: ExtractedFact["factType"]) {
  return result.facts.some((fact) => fact.factType === factType);
}

function evidencePayloads(result: { facts: ExtractedFact[] }, factType: ExtractedFact["factType"]) {
  return result.facts
    .filter((fact) => fact.factType === factType)
    .flatMap((fact) => fact.evidence.map((evidence) => evidence.payload));
}

function createTestDb(): Queryable {
  const db = newDb();
  const schema = readFileSync(
    path.join(process.cwd(), "src", "db", "migrations", "001_initial_schema.sql"),
    "utf8"
  );

  db.public.none(schema);

  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

describe("static HTML fact extraction", () => {
  it("extracts forms, personal-data fields, consent controls, consent text, action targets, and multiple forms", () => {
    const result = extractStaticFacts(
      [
        page(
          "https://example.test/contact",
          `
            <a href="/privacy">Политика обработки персональных данных</a>
            <form action="/lead" method="post">
              <label for="fio">ФИО</label><input id="fio" name="fio" required>
              <label>Email <input type="email" name="email" autocomplete="email"></label>
              <input type="tel" name="phone" placeholder="Телефон">
              <label><input type="checkbox" name="pd" checked> Согласие на обработку персональных данных <a href="/privacy">policy</a></label>
              <button>Отправить</button>
            </form>
            <form action="https://crm.example.test/subscribe">
              <input name="comment" placeholder="Комментарий">
              <label><input type="checkbox" name="ads"> Подписаться на рекламную рассылку</label>
            </form>
          `
        )
      ],
      { crawlCompleted: true, startUrl: "https://example.test/contact" }
    );

    expect(values(result, "form_found")).toHaveLength(2);
    expect(values(result, "form_action_target")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionUrl: "https://example.test/lead", method: "post" }),
        expect.objectContaining({ actionUrl: "https://crm.example.test/subscribe", externalToPageHost: true })
      ])
    );
    expect(values(result, "form_fields")[0]).toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({ name: "fio", required: true, personalDataCategories: ["name"] }),
        expect.objectContaining({ name: "email", personalDataCategories: ["email"] }),
        expect.objectContaining({ name: "phone", personalDataCategories: ["phone"] })
      ])
    });
    expect(hasFact(result, "personal_data_collection_found")).toBe(true);
    expect(hasFact(result, "consent_control_found")).toBe(true);
    expect(hasFact(result, "pd_consent_control_found")).toBe(true);
    expect(hasFact(result, "control_prechecked_static")).toBe(true);
    expect(values(result, "consent_text")[0]).toMatchObject({
      text: expect.stringContaining("Согласие на обработку персональных данных"),
      links: [expect.objectContaining({ url: "https://example.test/privacy" })]
    });
    expect(hasFact(result, "marketing_consent_control_found")).toBe(true);
    expect(hasFact(result, "marketing_subscription_detected")).toBe(true);
    expect(values(result, "policy_access_from_collection_page")).toContainEqual(
      expect.objectContaining({ found: true })
    );
    expect(evidencePayloads(result, "consent_text")[0]).toMatchObject({
      context: expect.stringContaining("Согласие на обработку персональных данных")
    });
  });

  it("does not classify a form without personal-data signals as personal-data collection", () => {
    const result = extractStaticFacts(
      [page("https://example.test/search", `<form><input name="q" placeholder="Поиск"><button>Найти</button></form>`)],
      { crawlCompleted: true, startUrl: "https://example.test/search" }
    );

    expect(values(result, "form_found")).toHaveLength(1);
    expect(values(result, "personal_data_collection_found")).toContainEqual(
      expect.objectContaining({ found: false, scope: "SITE" })
    );
  });

  it("extracts privacy links, offer links, document links, and ignores ordinary links as documents", () => {
    const result = extractStaticFacts(
      [
        page(
          "https://shop.test/",
          `
            <a href="/privacy" title="Политика конфиденциальности">Privacy</a>
            <a href="/offer.html">Публичная оферта</a>
            <a href="/files/rules.pdf">PDF</a>
            <a href="/docs/contract.doc">DOC</a>
            <a href="/docs/template.docx">DOCX</a>
            <a href="/catalog">Каталог</a>
          `
        )
      ],
      { crawlCompleted: true, startUrl: "https://shop.test/" }
    );

    expect(values(result, "privacy_policy_url")).toContainEqual({ url: "https://shop.test/privacy" });
    expect(values(result, "offer_url")).toContainEqual({ url: "https://shop.test/offer.html" });
    const pageDocumentLinks = values(result, "document_links").find((value) =>
      Array.isArray(value.links) && value.links.some((link: { url: string }) => link.url.endsWith(".pdf"))
    );
    expect(pageDocumentLinks).toMatchObject({
      links: [
        expect.objectContaining({ url: "https://shop.test/files/rules.pdf" }),
        expect.objectContaining({ url: "https://shop.test/docs/contract.doc" }),
        expect.objectContaining({ url: "https://shop.test/docs/template.docx" })
      ]
    });
    expect(JSON.stringify(pageDocumentLinks)).not.toContain("/catalog");
  });

  it("detects general public offer links conservatively", () => {
    const result = extractStaticFacts(
      [
        page(
          "https://shop.test/",
          `
            <a href="/offer">Публичная оферта</a>
            <a href="/distance-sale-terms">Условия дистанционной продажи</a>
          `
        )
      ],
      { crawlCompleted: true, startUrl: "https://shop.test/" }
    );

    expect(values(result, "offer_url")).toEqual(
      expect.arrayContaining([
        { url: "https://shop.test/offer" },
        { url: "https://shop.test/distance-sale-terms" }
      ])
    );
  });

  it("does not treat specialized certificate, bonus, or promotion terms as a general offer", () => {
    const result = extractStaticFacts(
      [
        page(
          "https://shop.test/",
          `
            <a href="/certificate-terms.pdf">Типовые условия договора купли-продажи электронных подарочных сертификатов</a>
            <a href="/bonus-rules">Правила бонусной программы</a>
            <a href="/promotions/terms">Условия акции</a>
          `
        )
      ],
      { crawlCompleted: true, startUrl: "https://shop.test/" }
    );

    expect(values(result, "offer_link_found")).not.toContainEqual(expect.objectContaining({ found: true }));
    expect(values(result, "offer_url")).toEqual([]);
  });

  it("extracts seller candidates and ignores random 13/15 digit numbers without OGRN context", () => {
    const result = extractStaticFacts(
      [
        page(
          "https://shop.test/contacts",
          `
            <footer>
              Реквизиты: ООО "Ромашка", ОГРН 1027700132195, юридический адрес: 123456, г. Москва, ул. Ленина, д. 1.
              Email: sales@example.ru, телефон +7 (495) 123-45-67. Режим работы: пн-пт 10:00-19:00.
              Справочный номер 1234567890123 и код 123456789012345.
            </footer>
          `
        ),
        page(
          "https://shop.test/ip",
          `<section class="requisites">ИП Иванов Иван Иванович, ОГРНИП 304500116000157</section>`
        )
      ],
      { crawlCompleted: true, startUrl: "https://shop.test/" }
    );

    expect(values(result, "seller_legal_name_candidate")[0]).toMatchObject({
      value: expect.stringContaining("ООО")
    });
    expect(values(result, "ogrn_candidate")).toContainEqual(expect.objectContaining({ value: "1027700132195" }));
    expect(values(result, "ogrnip_candidate")).toContainEqual(expect.objectContaining({ value: "304500116000157" }));
    expect(values(result, "seller_fio_candidate")[0]).toMatchObject({
      value: "ИП Иванов Иван Иванович"
    });
    expect(values(result, "seller_address_candidate")[0]).toMatchObject({
      value: expect.stringContaining("адрес")
    });
    expect(values(result, "seller_email_found")[0]).toMatchObject({ found: true, maskedValue: "s***@example.ru" });
    expect(values(result, "seller_phone_found")[0]).toMatchObject({ found: true, maskedValue: "+7 *** *** ** 67" });
    expect(hasFact(result, "working_hours_candidate")).toBe(true);
    expect(JSON.stringify(values(result, "ogrn_candidate"))).not.toContain("1234567890123");
  });

  it("does not create seller requisites for a page without requisites", () => {
    const result = extractStaticFacts(
      [page("https://shop.test/about", `<main>Мы любим качественный сервис и красивые витрины.</main>`)],
      { crawlCompleted: true, startUrl: "https://shop.test/about" }
    );

    expect(hasFact(result, "ogrn_candidate")).toBe(false);
    expect(hasFact(result, "ogrnip_candidate")).toBe(false);
    expect(hasFact(result, "seller_legal_name_candidate")).toBe(false);
  });

  it("extracts ruble and foreign price occurrences without treating ordinary numbers as prices", () => {
    const result = extractStaticFacts(
      [
        page(
          "https://shop.test/product",
          `
            <main>
              <p>Товар 1 990 ₽</p>
              <p>Доставка 1990 руб.</p>
              <p>International plan 25 USD</p>
              <p>Артикул 123456</p>
            </main>
          `
        )
      ],
      { crawlCompleted: true, startUrl: "https://shop.test/product" }
    );

    expect(values(result, "price_occurrence")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 1990, currencyMarker: "₽", isRuble: true }),
        expect.objectContaining({ amount: 1990, currencyMarker: "руб.", isRuble: true }),
        expect.objectContaining({ amount: 25, currencyMarker: "USD", isRuble: false })
      ])
    );
    expect(values(result, "price_occurrence").map((value) => value.amount)).not.toContain(123456);
    expect(values(result, "ruble_price_found")).toContainEqual(expect.objectContaining({ found: true }));
  });

  it("does not emit false site-level absence facts for partial crawl", () => {
    const result = extractStaticFacts([page("https://example.test/", "<main>No policy here</main>")], {
      crawlCompleted: false,
      startUrl: "https://example.test/"
    });

    expect(values(result, "privacy_policy_link_found")).not.toContainEqual(
      expect.objectContaining({ found: false })
    );
    expect(values(result, "scan_coverage")).toContainEqual(expect.objectContaining({ crawlCompleted: false }));
  });

  it("marks obvious anti-bot or challenge pages as content-limited", () => {
    const result = extractStaticFacts(
      [
        {
          ...page(
            "https://example.test/security-check",
            "<html><title>Security check</title><body>Please verify you are human before continuing.</body></html>"
          ),
          title: "Security check"
        }
      ],
      { crawlCompleted: true, startUrl: "https://example.test/" }
    );

    expect(values(result, "scan_coverage")).toContainEqual(
      expect.objectContaining({
        crawlCompleted: true,
        contentLimited: true,
        limitationReason: expect.any(String)
      })
    );
    expect(values(result, "personal_data_collection_found")).not.toContainEqual(
      expect.objectContaining({ found: false })
    );
    expect(values(result, "privacy_policy_link_found")).not.toContainEqual(
      expect.objectContaining({ found: false })
    );
  });

  it("extracts readable privacy policy text evidence from crawled HTML policy pages", () => {
    const result = extractStaticFacts(
      [
        page("https://example.test/", `<a href="/privacy">Политика обработки персональных данных</a>`),
        page(
          "https://example.test/privacy",
          `
            <header>Главное меню</header>
            <nav>Каталог Новости Контакты</nav>
            <main>
              <h1>Политика обработки персональных данных</h1>
              <p>Цель обработки: подготовка ответа на обращение пользователя.</p>
              <p>Категории данных: имя, телефон, адрес электронной почты.</p>
            </main>
            <script>window.secret = "do-not-include"</script>
            <style>body { color: red; }</style>
            <footer>Подвал сайта</footer>
          `
        )
      ],
      { crawlCompleted: true, startUrl: "https://example.test/" }
    );

    expect(values(result, "privacy_policy_text")[0]).toMatchObject({
      sourceUrl: "https://example.test/privacy",
      text: expect.stringContaining("Цель обработки"),
      truncated: false
    });
    expect(evidencePayloads(result, "privacy_policy_text")[0]).toMatchObject({
      kind: "privacy_policy_text",
      sourceUrl: "https://example.test/privacy",
      text: expect.stringContaining("Категории данных")
    });
    expect(JSON.stringify(values(result, "privacy_policy_text"))).not.toContain("Главное меню");
    expect(JSON.stringify(values(result, "privacy_policy_text"))).not.toContain("window.secret");
    expect(JSON.stringify(values(result, "privacy_policy_text"))).not.toContain("Подвал сайта");
  });

  it("preserves policy text over the previous 12k limit when under the 50k cap", () => {
    const longPolicyText = Array.from({ length: 1_000 }, (_value, index) => `Пункт политики ${index}`).join(". ");
    const result = extractStaticFacts(
      [
        page("https://example.test/", `<a href="/privacy">Privacy</a>`),
        page("https://example.test/privacy", `<main>${longPolicyText}</main>`)
      ],
      { crawlCompleted: true, startUrl: "https://example.test/" }
    );
    const policyText = values(result, "privacy_policy_text")[0] as {
      sourceUrl: string;
      text: string;
      truncated: boolean;
      maxChars: number;
      originalTextLength: number;
    };

    expect(policyText.sourceUrl).toBe("https://example.test/privacy");
    expect(policyText.originalTextLength).toBeGreaterThan(12_000);
    expect(policyText.originalTextLength).toBeLessThan(policyText.maxChars);
    expect(policyText.truncated).toBe(false);
    expect(policyText.text.length).toBe(policyText.originalTextLength);
    expect(policyText.maxChars).toBe(50_000);
  });

  it("marks privacy policy text over the 50k cap as truncated", () => {
    const longPolicyText = Array.from({ length: 4_000 }, (_value, index) => `Пункт политики ${index}`).join(". ");
    const result = extractStaticFacts(
      [
        page("https://example.test/", `<a href="/privacy">Privacy</a>`),
        page("https://example.test/privacy", `<main>${longPolicyText}</main>`)
      ],
      { crawlCompleted: true, startUrl: "https://example.test/" }
    );
    const policyText = values(result, "privacy_policy_text")[0] as {
      text: string;
      truncated: boolean;
      maxChars: number;
      originalTextLength: number;
    };

    expect(policyText.maxChars).toBe(50_000);
    expect(policyText.truncated).toBe(true);
    expect(policyText.text.length).toBe(policyText.maxChars);
    expect(policyText.originalTextLength).toBeGreaterThan(policyText.maxChars);
  });

  it("does not invent privacy policy text evidence when policy page text is absent or not crawled", () => {
    const notCrawled = extractStaticFacts(
      [page("https://example.test/", `<a href="/privacy">Политика обработки персональных данных</a>`)],
      { crawlCompleted: true, startUrl: "https://example.test/" }
    );
    const emptyPolicy = extractStaticFacts(
      [
        page("https://example.test/", `<a href="/privacy">Политика обработки персональных данных</a>`),
        page("https://example.test/privacy", `<html><body><nav>Меню</nav><script>1</script></body></html>`)
      ],
      { crawlCompleted: true, startUrl: "https://example.test/" }
    );

    expect(values(notCrawled, "privacy_policy_text")).toEqual([]);
    expect(values(emptyPolicy, "privacy_policy_text")).toEqual([]);
  });
});

describe("static HTML extraction persistence", () => {
  let db: Queryable;

  beforeEach(() => {
    db = createTestDb();
  });

  async function createScan() {
    const user = await upsertUser(db, {
      id: "00000000-0000-4000-8000-000000000004",
      email: "task004@example.test"
    });
    const site = await createSite(db, {
      userId: user.id,
      url: "https://example.test",
      normalizedDomain: "example.test"
    });

    return createQueuedScan(db, {
      siteId: site.id,
      siteType: "ECOMMERCE",
      scannerVersion: "task004-test"
    });
  }

  it("persists facts and evidence for the correct scan, with page_url null for aggregate facts", async () => {
    const scan = await createScan();
    const extraction = extractStaticFacts(
      [page("https://example.test/", `<a href="/privacy">Политика конфиденциальности</a><p>Цена 1 990 ₽</p>`)],
      { crawlCompleted: true, startUrl: "https://example.test/" }
    );

    const persisted = await persistStaticExtraction(db, scan.id, extraction);
    const facts = await db.query<{ id: string; scan_id: string; page_url: string | null; fact_type: string }>(
      "select id, scan_id, page_url, fact_type from facts where scan_id = $1 order by created_at",
      [scan.id]
    );
    const evidence = await db.query<{ fact_id: string | null; scan_id: string }>(
      "select fact_id, scan_id from evidence where scan_id = $1",
      [scan.id]
    );

    expect(persisted.factCount).toBeGreaterThan(0);
    expect(facts.rows.every((fact) => fact.scan_id === scan.id)).toBe(true);
    expect(evidence.rows.every((row) => row.scan_id === scan.id && row.fact_id)).toBe(true);
    expect(facts.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fact_type: "privacy_policy_url", page_url: null }),
        expect.objectContaining({ fact_type: "scan_coverage", page_url: null })
      ])
    );
  });

  it("does not overwrite facts from an older scan when a second scan is persisted", async () => {
    const first = await createScan();
    await persistStaticExtraction(
      db,
      first.id,
      extractStaticFacts([page("https://example.test/", `<p>Цена 1 990 ₽</p>`)], {
        crawlCompleted: true,
        startUrl: "https://example.test/"
      })
    );
    await db.query("update scans set status = 'RUNNING' where id = $1", [first.id]);
    await completeScan(db, first.id);

    const second = await createScan();
    await persistStaticExtraction(
      db,
      second.id,
      extractStaticFacts([page("https://example.test/", `<p>Цена 2 990 ₽</p>`)], {
        crawlCompleted: true,
        startUrl: "https://example.test/"
      })
    );

    const firstFacts = await db.query<{ value_json: { amount?: number } }>(
      "select value_json from facts where scan_id = $1 and fact_type = 'price_occurrence'",
      [first.id]
    );
    const secondFacts = await db.query<{ value_json: { amount?: number } }>(
      "select value_json from facts where scan_id = $1 and fact_type = 'price_occurrence'",
      [second.id]
    );

    expect(firstFacts.rows).toEqual([expect.objectContaining({ value_json: expect.objectContaining({ amount: 1990 }) })]);
    expect(secondFacts.rows).toEqual([expect.objectContaining({ value_json: expect.objectContaining({ amount: 2990 }) })]);
  });
});
