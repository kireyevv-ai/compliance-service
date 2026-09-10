import { readFileSync } from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { startScan, userSafeScanError } from "@/app/api/scans/helpers";
import { claimNextQueuedScan, completeScan, failScan } from "@/db/repository";
import {
  buildFindingViewModels,
  EMPTY_RESULT_NOTE,
  EMPTY_RESULT_TITLE,
  formatExternalServices,
  resultsHeaderSummaryText,
  SCOPE_DISCLAIMER,
  sortFindings,
  summarizeFindings
} from "@/app/results/presentation";
import type { Queryable } from "@/db/client";
import type { Evidence } from "@/evidence/types";
import type { Finding } from "@/findings/types";

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

async function scanCount(db: Queryable): Promise<number> {
  const result = await db.query<{ count: number | string }>("select count(*) as count from scans");
  return Number(result.rows[0].count);
}

function finding(status: Finding["status"], ruleId: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id: `${ruleId}-${status}`,
    scanId: "00000000-0000-4000-8000-000000000101",
    ruleId,
    ruleVersion: "1",
    status,
    severity: status === "FAIL" ? "HIGH" : "LOW",
    confidence: 0.9,
    summary: `${ruleId} summary`,
    explanation: `${ruleId} explanation`,
    remediation: `${ruleId} remediation`,
    missingContext: [],
    createdAt: new Date("2026-09-06T12:00:00Z"),
    ...overrides
  };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "00000000-0000-4000-8000-000000000201",
    scanId: "00000000-0000-4000-8000-000000000101",
    evidenceType: "DOM_FRAGMENT",
    pageUrl: "https://example.ru/contact",
    payload: { context: "Форма обратной связи", fragment: "<form>Телефон</form>" },
    createdAt: new Date("2026-09-06T12:00:00Z"),
    ...overrides
  };
}

describe("first user flow", () => {
  it("requires URL before creating a Scan", async () => {
    const db = createTestDb();
    const result = await startScan({ url: "", siteType: "B2B" }, { db });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(await scanCount(db)).toBe(0);
  });

  it("requires site type before creating a Scan", async () => {
    const db = createTestDb();
    const result = await startScan({ url: "example.ru" }, { db });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(await scanCount(db)).toBe(0);
  });

  it("does not create a Scan for an unsupported URL scheme", async () => {
    const db = createTestDb();
    const result = await startScan(
      { url: "mailto:owner@example.ru", siteType: "B2B" },
      { db }
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(await scanCount(db)).toBe(0);
  });

  it("creates a Site and persists the selected site_type on a new Scan", async () => {
    const db = createTestDb();
    const result = await startScan(
      { url: "example.ru", siteType: "ECOMMERCE" },
      { db }
    );

    expect(result.ok).toBe(true);
    expect(result.statusValue).toBe("QUEUED");

    const scanResult = await db.query<{ site_type: string; status: string }>(
      "select site_type, status from scans where id = $1",
      [result.ok ? result.scanId : ""]
    );
    const siteResult = await db.query<{ normalized_domain: string }>("select normalized_domain from sites");

    expect(scanResult.rows[0]).toEqual({ site_type: "ECOMMERCE", status: "QUEUED" });
    expect(siteResult.rows[0].normalized_domain).toBe("example.ru");
  });

  it("queues another Scan while a previous Scan is still active for the beta user", async () => {
    const db = createTestDb();
    const first = await startScan({ url: "example.ru", siteType: "B2B" }, { db });
    const second = await startScan({ url: "another-example.ru", siteType: "B2B" }, { db });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.statusValue).toBe("QUEUED");
    expect(await scanCount(db)).toBe(2);
  });

  it("allows a new Scan after the previous active Scan finishes or fails", async () => {
    const db = createTestDb();
    const first = await startScan({ url: "example.ru", siteType: "B2B" }, { db });
    const runningFirst = await claimNextQueuedScan(db, { useSkipLocked: false });
    await completeScan(db, runningFirst!.id);
    const second = await startScan({ url: "another-example.ru", siteType: "B2B" }, { db });
    const runningSecond = await claimNextQueuedScan(db, { useSkipLocked: false });
    await failScan(db, runningSecond!.id, "synthetic failure");
    const third = await startScan({ url: "third-example.ru", siteType: "B2B" }, { db });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(true);
    expect(await scanCount(db)).toBe(3);
  });
});

describe("results presentation", () => {
  it("summarizes findings without producing a compliance score", () => {
    const summary = summarizeFindings([
      finding("FAIL", "PD-001"),
      finding("WARNING", "PD-020"),
      finding("MANUAL_CHECK", "PD-022"),
      finding("PASS", "EC-001")
    ]);

    expect(summary).toEqual({ fail: 1, warning: 1, manual: 1, pass: 1 });
    expect(Object.keys(summary)).not.toContain("score");
  });

  it("orders findings as FAIL, WARNING, MANUAL_CHECK, PASS", () => {
    const ordered = sortFindings([
      finding("PASS", "EC-001"),
      finding("MANUAL_CHECK", "PD-022"),
      finding("FAIL", "PD-001"),
      finding("WARNING", "PD-020")
    ]);

    expect(ordered.map((item) => item.status)).toEqual(["FAIL", "WARNING", "MANUAL_CHECK", "PASS"]);
  });

  it("renders finding labels, legal basis, remediation, and readable evidence", () => {
    const sourceFinding = finding("FAIL", "PD-001");
    const [view] = buildFindingViewModels(sourceFinding ? [sourceFinding] : [], {
      [sourceFinding.id]: [evidence()]
    });

    expect(view.statusLabel).toBe("Требует исправления");
    expect(view.summary).toBe("PD-001 summary");
    expect(view.explanation).toBe("PD-001 explanation");
    expect(view.remediation).toBe("PD-001 remediation");
    expect(view.legalBasis).toContain("152-ФЗ, ст. 18.1 ч. 2");
    expect(view.evidence[0]).toMatchObject({
      pageUrl: "https://example.ru/contact",
      label: "Форма сбора персональных данных",
      links: []
    });
    expect(view.evidence[0].detail).toBe("Форма сбора персональных данных");
    expect(view.evidence[0].detail).not.toContain("<form>");
    expect(view.evidence[0].detail).not.toContain('{"');
  });

  it("formats linked PASS evidence without exposing raw payload internals", () => {
    const sourceFinding = finding("PASS", "EC-001");
    const [view] = buildFindingViewModels([sourceFinding], {
      [sourceFinding.id]: [
        evidence({
          evidenceType: "DOCUMENT_REFERENCE",
          pageUrl: "https://shop.example.ru/",
          payload: {
            kind: "offer_link_found",
            url: "https://shop.example.ru/offer",
            href: "/offer",
            text: "Публичная оферта",
            selector: "a:eq(2)",
            fragment: "<a href=\"/offer\">Публичная оферта</a>"
          }
        })
      ]
    });

    expect(view.evidence[0].pageUrl).toBe("https://shop.example.ru/");
    expect(view.evidence[0].detail).toBe("Публичная оферта · https://shop.example.ru/offer");
    expect(view.evidence[0].links).toEqual([
      { url: "https://shop.example.ru/offer", label: "https://shop.example.ru/offer" }
    ]);
    expect(view.evidence[0].detail).not.toContain("offer_link_found");
    expect(view.evidence[0].detail).not.toContain("selector");
    expect(view.evidence[0].detail).not.toContain("<a");
  });

  it("formats seller, price, and policy-access evidence from existing evidence only", () => {
    const sourceFinding = finding("PASS", "EC-006");
    const [view] = buildFindingViewModels([sourceFinding], {
      [sourceFinding.id]: [
        evidence({
          pageUrl: "https://shop.example.ru/about",
          payload: {
            kind: "seller_email_found",
            context:
              "Покупателям Программа лояльности Написать обращение +7 *** *** ** 44 Интернет-магазин c***@bookcentre.ru длинный текст"
          }
        }),
        evidence({
          pageUrl: "https://shop.example.ru/product",
          payload: { kind: "price_occurrence", amount: 1990, currencyMarker: "₽", context: "Цена 1 990 ₽" }
        }),
        evidence({
          pageUrl: "https://shop.example.ru/checkout",
          payload: {
            kind: "policy_access_from_collection_page",
            context: "A privacy/personal-data policy link was found on the collection page."
          }
        })
      ]
    });

    expect(view.evidence.map((item) => item.pageUrl)).toEqual([
      "https://shop.example.ru/about",
      "https://shop.example.ru/product",
      "https://shop.example.ru/checkout"
    ]);
    expect(view.evidence.map((item) => item.detail)).toEqual([
      "c***@bookcentre.ru",
      "1 990 ₽",
      undefined
    ]);
  });

  it("hides derived seller messages and keeps only normalized user-facing values", () => {
    const [legalName, contact, price, policyAccess] = buildFindingViewModels(
      [
        finding("PASS", "EC-003"),
        finding("PASS", "EC-006"),
        finding("PASS", "EC-013"),
        finding("PASS", "PD-003")
      ],
      {
        "EC-003-PASS": [
          evidence({
            pageUrl: "https://shop.example.ru/",
            payload: { kind: "seller_kind", context: "Derived from explicit LEGAL_ENTITY requisites candidates." }
          })
        ],
        "EC-006-PASS": [
          evidence({
            pageUrl: "https://shop.example.ru/contacts",
            payload: {
              kind: "seller_email_found",
              context:
                "Корпоративным клиентам Отвечаем по будням c***@bookcentre.ru Поставщикам p***@bookcentre.ru длинный текст"
            }
          })
        ],
        "EC-013-PASS": [
          evidence({
            pageUrl: "https://shop.example.ru/",
            payload: {
              kind: "ruble_price_found",
              context: "Твердая обложка839 ₽ 699 ₽-17%Как не влюбиться в ведьму Купить"
            }
          })
        ],
        "PD-003-PASS": [
          evidence({
            pageUrl: "https://shop.example.ru/checkout",
            payload: {
              kind: "policy_access_from_collection_page",
              sources: [{ url: "https://shop.example.ru/about/policy" }]
            }
          })
        ]
      }
    );

    expect(legalName.evidence[0].detail).toBeUndefined();
    expect(contact.evidence[0].detail).toBe("c***@bookcentre.ru");
    expect(price.evidence[0].detail).toBe("699 ₽");
    expect(policyAccess.evidence[0].links).toEqual([
      { url: "https://shop.example.ru/about/policy", label: "https://shop.example.ru/about/policy" }
    ]);
    expect(JSON.stringify([legalName, contact, price, policyAccess])).not.toContain("Derived from");
    expect(JSON.stringify([contact, price])).not.toContain("длинный текст");
  });

  it("renders failed PD-001 form evidence without technical labels or raw HTML", () => {
    const [view] = buildFindingViewModels(
      [finding("FAIL", "PD-001")],
      {
        "PD-001-FAIL": [
          evidence({
            pageUrl: "https://example.ru/lead",
            evidenceType: "DOM_FRAGMENT",
            payload: {
              fragment: "<form><input name=\"email\" type=\"email\"><button>Send</button></form>",
              selector: "form:eq(0)"
            }
          })
        ]
      }
    );

    expect(view.evidence).toHaveLength(1);
    expect(view.evidence[0]).toMatchObject({
      pageUrl: "https://example.ru/lead",
      label: "Форма сбора персональных данных",
      detail: "Форма сбора персональных данных"
    });

    const visiblePayload = JSON.stringify(view.evidence);
    expect(visiblePayload).not.toMatch(/DOM_FRAGMENT|form:eq|<form|input name|00000000|payload|fragment/i);
  });

  it("renders PASS findings with runtime positive pass_summary instead of stale stored summary", () => {
    const [view] = buildFindingViewModels(
      [
        finding("PASS", "PD-001", {
          summary: "Проверка пройдена: Политика обработки ПД не найдена на сайте, который собирает ПД"
        })
      ],
      {}
    );

    expect(view.summary).toBe("Политика обработки персональных данных найдена.");
    expect(view.summary).not.toContain("Проверка пройдена:");
    expect(view.summary).not.toContain("не найдена");
  });

  it("updates old saved PASS summaries from runtime presentation mapping", () => {
    const [offer, contact, policyAccess] = buildFindingViewModels(
      [
        finding("PASS", "EC-001", {
          summary: "Доступная оферта для дистанционной продажи найдена."
        }),
        finding("PASS", "EC-006", {
          summary: "Контактный e-mail или телефон российского юрлица-продавца обнаружен."
        }),
        finding("PASS", "PD-003", {
          summary: "На странице сбора персональных данных есть доступ к политике."
        })
      ],
      {}
    );

    expect(offer.summary).toBe("Оферта для дистанционной продажи найдена и доступна.");
    expect(contact.summary).toBe("Контактные данные продавца найдены.");
    expect(policyAccess.summary).toBe(
      "На странице сбора персональных данных размещена ссылка на политику обработки персональных данных."
    );
  });

  it("keeps branch-specific PASS summaries when they are already safe", () => {
    const [view] = buildFindingViewModels(
      [
        finding("PASS", "PD-001", {
          summary: "На проверенных страницах не обнаружены формы, собирающие персональные данные."
        })
      ],
      {}
    );

    expect(view.summary).toBe(
      "На проверенных страницах не обнаружены формы, собирающие персональные данные."
    );
  });

  it("does not replace non-PASS summaries with pass_summary", () => {
    const [view] = buildFindingViewModels([finding("FAIL", "PD-001")], {});

    expect(view.summary).toBe("PD-001 summary");
  });

  it("keeps warning and manual-check wording cautious", () => {
    const [warning, manual] = buildFindingViewModels(
      [
        finding("WARNING", "PD-020"),
        finding("MANUAL_CHECK", "PD-022", { missingContext: ["database_location"] })
      ],
      {}
    );

    expect(warning.statusLabel).toBe("Требует внимания");
    expect(warning.statusLabel).not.toContain("Нарушение");
    expect(manual.statusLabel).toBe("Нужна дополнительная проверка");
    expect(manual.missingContext).toEqual(["database_location"]);
  });

  it("extracts external services as neutral information", () => {
    const services = formatExternalServices({
      services: [{ service_name: "Yandex Metrica" }, { service_name: "Google tag / Google Analytics" }]
    });

    expect(services).toEqual(["Yandex Metrica", "Google tag / Google Analytics"]);
    expect(services.join(" ")).not.toContain("наруш");
  });

  it("keeps empty-result and scope disclaimer copy free of limited-coverage diagnostics", () => {
    const visibleCopy = [EMPTY_RESULT_TITLE, EMPTY_RESULT_NOTE, SCOPE_DISCLAIMER].join(" ");

    expect(EMPTY_RESULT_TITLE).toBe("Проблем не выявлено.");
    expect(EMPTY_RESULT_NOTE).toBe(
      "Проверка охватывает только параметры, доступные в текущей версии сервиса."
    );
    expect(SCOPE_DISCLAIMER).toContain("информационный характер");
    expect(visibleCopy).not.toMatch(/частич|не полностью|limited|anti-bot|oversized|crawler|browser/i);
  });

  it("summarizes only evaluated parameters in Results UI header", () => {
    expect(resultsHeaderSummaryText({ fail: 0, warning: 0, manual: 0, pass: 4 })).toEqual({
      checkedText: "Проверено 4 параметров сайта.",
      issueText: "Проблем не выявлено."
    });
    expect(resultsHeaderSummaryText({ fail: 1, warning: 2, manual: 1, pass: 3 })).toEqual({
      checkedText: "Проверено 7 параметров сайта.",
      issueText: "Выявлено 4 проблем."
    });
  });

  it("does not expose applicability or limited-coverage diagnostics in Results UI header", () => {
    const header = resultsHeaderSummaryText({ fail: 0, warning: 0, manual: 0, pass: 0 });
    const visibleCopy = `${header.checkedText} ${header.issueText}`;

    expect(visibleCopy).toBe("Проверено 0 параметров сайта. Проблем не выявлено.");
    expect(visibleCopy).not.toMatch(/применим|не удалось|огранич|частич|anti-bot|oversized|crawler|browser/i);
  });

  it("hides unsafe failed-scan details", () => {
    expect(userSafeScanError("HTTP request timeout")).toBe(
      "Сайт не ответил за отведённое время. Попробуйте позже."
    );
    expect(userSafeScanError("Response body too large")).toBe(
      "Проверка завершилась ошибкой. Попробуйте позже."
    );
    expect(userSafeScanError("Some unexpected internal exception")).toBe(
      "Проверка завершилась ошибкой. Попробуйте позже."
    );
    expect(userSafeScanError("SQL error at C:\\project\\src\\db.ts")).toBeUndefined();
  });
});
