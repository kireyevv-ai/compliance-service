import type { StaticExtractionResult } from "@/facts/extractors/types";
import type { CrawledPage } from "@/scanner/crawl/types";
import { normalizeUserUrl } from "@/scanner/normalization/url";
import type { BrowserAuditConfig } from "./config";

const AUTH_PAGE_RE = /(login|auth|signin|sign-in|account|register|вход|авторизац|регистрац)/iu;
const CHECKOUT_PAGE_RE = /(cart|basket|checkout|order|payment|корзин|заказ|оплат)/iu;
const CONSENT_FACTS = new Set(["consent_control_found", "pd_consent_control_found", "marketing_consent_control_found", "marketing_subscription_detected"]);
const FORM_FACTS = new Set(["form_found", "form_fields", "personal_data_collection_found"]);

export function selectBrowserAuditPages(input: {
  pages: CrawledPage[];
  staticExtraction: StaticExtractionResult;
  startUrl: string;
  config: Pick<BrowserAuditConfig, "maxBrowserPages">;
}): string[] {
  const selected = new Set<string>();
  const pageUrls = new Set(input.pages.map((page) => page.url));
  const normalizedStart = normalizeUserUrl(input.startUrl).canonicalStartUrl;

  addIfCrawled(selected, pageUrls, normalizedStart);
  addIfCrawled(selected, pageUrls, input.pages[0]?.url);

  addFactsByType(selected, pageUrls, input.staticExtraction, FORM_FACTS);
  addFactsByType(selected, pageUrls, input.staticExtraction, CONSENT_FACTS);

  for (const page of input.pages) {
    if (AUTH_PAGE_RE.test(page.url)) {
      addIfCrawled(selected, pageUrls, page.url);
    }
  }

  for (const page of input.pages) {
    if (CHECKOUT_PAGE_RE.test(page.url)) {
      addIfCrawled(selected, pageUrls, page.url);
    }
  }

  return [...selected].slice(0, input.config.maxBrowserPages);
}

export function isCheckoutLikePage(url: string): boolean {
  return CHECKOUT_PAGE_RE.test(url);
}

function addFactsByType(
  selected: Set<string>,
  pageUrls: Set<string>,
  extraction: StaticExtractionResult,
  factTypes: Set<string>
): void {
  for (const fact of extraction.facts) {
    if (fact.pageUrl && factTypes.has(fact.factType)) {
      addIfCrawled(selected, pageUrls, fact.pageUrl);
    }
  }
}

function addIfCrawled(selected: Set<string>, pageUrls: Set<string>, url?: string): void {
  if (url && pageUrls.has(url)) {
    selected.add(url);
  }
}
