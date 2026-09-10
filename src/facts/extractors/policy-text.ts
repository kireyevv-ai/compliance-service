import * as cheerio from "cheerio";
import type { CrawledPage } from "@/scanner/crawl/types";
import type { ExtractedEvidence, ExtractedFact } from "./types";

export const DEFAULT_POLICY_TEXT_LIMIT = 50_000;

export interface PolicyTextExtractionOptions {
  maxChars?: number;
}

export function extractPolicyTextFacts(
  pages: CrawledPage[],
  policyUrls: string[],
  options: PolicyTextExtractionOptions = {}
): ExtractedFact[] {
  const maxChars = options.maxChars ?? DEFAULT_POLICY_TEXT_LIMIT;
  const policyUrlSet = new Set(policyUrls.map(normalizeUrl).filter((url): url is string => Boolean(url)));
  const facts: ExtractedFact[] = [];

  if (policyUrlSet.size === 0) {
    return facts;
  }

  for (const page of pages) {
    const normalizedPageUrl = normalizeUrl(page.url);
    if (!normalizedPageUrl || !policyUrlSet.has(normalizedPageUrl) || !isHtmlPage(page)) {
      continue;
    }

    const extracted = extractReadableTextFromHtml(page.html, maxChars);
    if (!extracted || extracted.text.length === 0) {
      continue;
    }

    facts.push({
      pageUrl: page.url,
      factType: "privacy_policy_text",
      value: {
        sourceUrl: page.url,
        text: extracted.text,
        textLength: extracted.text.length,
        originalTextLength: extracted.originalTextLength,
        truncated: extracted.truncated,
        maxChars
      },
      evidence: [policyTextEvidence(page.url, extracted, maxChars)]
    });
  }

  return facts;
}

function extractReadableTextFromHtml(
  html: string,
  maxChars: number
): { text: string; originalTextLength: number; truncated: boolean } | undefined {
  const $ = cheerio.load(html);

  $("script, style, noscript, template, svg, header, footer, nav, aside, form").remove();
  $("[aria-hidden='true'], [hidden]").remove();
  $(
    "[class*='nav' i], [id*='nav' i], [class*='menu' i], [id*='menu' i], [class*='footer' i], [id*='footer' i], [class*='header' i], [id*='header' i], [class*='cookie' i], [id*='cookie' i]"
  ).remove();

  const root = $("main, article, [role='main']").first();
  const rawText = compactText((root.length > 0 ? root : $("body")).text());

  if (!rawText) {
    return undefined;
  }

  const truncated = rawText.length > maxChars;
  return {
    text: truncated ? rawText.slice(0, maxChars) : rawText,
    originalTextLength: rawText.length,
    truncated
  };
}

function policyTextEvidence(
  pageUrl: string,
  extracted: { text: string; originalTextLength: number; truncated: boolean },
  maxChars: number
): ExtractedEvidence {
  return {
    evidenceType: "TEXT_FRAGMENT",
    pageUrl,
    payload: {
      kind: "privacy_policy_text",
      sourceUrl: pageUrl,
      text: extracted.text,
      textLength: extracted.text.length,
      originalTextLength: extracted.originalTextLength,
      truncated: extracted.truncated,
      maxChars
    }
  };
}

function isHtmlPage(page: CrawledPage): boolean {
  return page.status >= 200 && page.status < 400 && /(?:^|;|\s)text\/html\b/i.test(page.contentType) && page.html.trim().length > 0;
}

function normalizeUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
