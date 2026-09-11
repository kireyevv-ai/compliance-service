import * as cheerio from "cheerio";
import type { CrawledPage } from "@/scanner/crawl/types";
import type { ExtractedEvidence, ExtractedFact } from "./types";

export const DEFAULT_POLICY_TEXT_LIMIT = 50_000;
export type PolicyTextExtractionRoot = "main" | "article" | "role_main" | "body";

export interface PolicyPageLimitationMetadata {
  contentLimited: boolean;
  limitationReason?: string | null;
  interstitialDetected: boolean;
}

export interface PolicyTextExtractionOptions {
  maxChars?: number;
  pageLimitations?: Map<string, PolicyPageLimitationMetadata>;
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

    const pageLimitation = normalizedPageUrl ? options.pageLimitations?.get(normalizedPageUrl) : undefined;
    facts.push({
      pageUrl: page.url,
      factType: "privacy_policy_text",
      value: {
        sourceUrl: page.url,
        documentType: documentTypeForPage(page),
        fetchStatus: page.status,
        fetchContentType: page.contentType,
        contentLimited: pageLimitation?.contentLimited ?? page.contentLimited === true,
        limitationReason: pageLimitation?.limitationReason ?? page.limitationReason,
        interstitialDetected: pageLimitation?.interstitialDetected ?? false,
        extractionSucceeded: extracted.extractionSucceeded,
        extractionRoot: extracted.extractionRoot,
        extractionRootFallback: extracted.extractionRootFallback,
        text: extracted.text,
        textLength: extracted.text.length,
        originalTextLength: extracted.originalTextLength,
        truncated: extracted.truncated,
        maxChars
      },
      evidence: [policyTextEvidence(page, extracted, maxChars, pageLimitation)]
    });
  }

  return facts;
}

function extractReadableTextFromHtml(
  html: string,
  maxChars: number
): {
  text: string;
  originalTextLength: number;
  truncated: boolean;
  extractionRoot: PolicyTextExtractionRoot;
  extractionRootFallback: boolean;
  extractionSucceeded: boolean;
} | undefined {
  const $ = cheerio.load(html);

  $("script, style, noscript, template, svg, header, footer, nav, aside, form").remove();
  $("[aria-hidden='true'], [hidden]").remove();
  $(
    "[class*='nav' i], [id*='nav' i], [class*='menu' i], [id*='menu' i], [class*='footer' i], [id*='footer' i], [class*='header' i], [id*='header' i], [class*='cookie' i], [id*='cookie' i]"
  ).remove();

  const root = selectExtractionRoot($);
  const rawText = compactText(root.element.text());

  if (!rawText) {
    return undefined;
  }

  const truncated = rawText.length > maxChars;
  return {
    text: truncated ? rawText.slice(0, maxChars) : rawText,
    originalTextLength: rawText.length,
    truncated,
    extractionRoot: root.kind,
    extractionRootFallback: root.fallback,
    extractionSucceeded: true
  };
}

function policyTextEvidence(
  page: CrawledPage,
  extracted: {
    text: string;
    originalTextLength: number;
    truncated: boolean;
    extractionRoot: PolicyTextExtractionRoot;
    extractionRootFallback: boolean;
    extractionSucceeded: boolean;
  },
  maxChars: number,
  pageLimitation: PolicyPageLimitationMetadata | undefined
): ExtractedEvidence {
  return {
    evidenceType: "TEXT_FRAGMENT",
    pageUrl: page.url,
    payload: {
      kind: "privacy_policy_text",
      sourceUrl: page.url,
      documentType: documentTypeForPage(page),
      fetchStatus: page.status,
      fetchContentType: page.contentType,
      contentLimited: pageLimitation?.contentLimited ?? page.contentLimited === true,
      limitationReason: pageLimitation?.limitationReason ?? page.limitationReason,
      interstitialDetected: pageLimitation?.interstitialDetected ?? false,
      extractionSucceeded: extracted.extractionSucceeded,
      extractionRoot: extracted.extractionRoot,
      extractionRootFallback: extracted.extractionRootFallback,
      text: extracted.text,
      textLength: extracted.text.length,
      originalTextLength: extracted.originalTextLength,
      truncated: extracted.truncated,
      maxChars
    }
  };
}

function selectExtractionRoot($: cheerio.CheerioAPI): {
  kind: PolicyTextExtractionRoot;
  fallback: boolean;
  element: ReturnType<cheerio.CheerioAPI>;
} {
  const main = $("main").first();
  if (main.length > 0) {
    return { kind: "main", fallback: false, element: main };
  }

  const article = $("article").first();
  if (article.length > 0) {
    return { kind: "article", fallback: false, element: article };
  }

  const roleMain = $("[role='main']").first();
  if (roleMain.length > 0) {
    return { kind: "role_main", fallback: false, element: roleMain };
  }

  return { kind: "body", fallback: true, element: $("body") };
}

function documentTypeForPage(page: CrawledPage): "HTML" | "PDF" | "OTHER" {
  if (/(?:^|;|\s)text\/html\b/i.test(page.contentType)) {
    return "HTML";
  }
  if (/(?:^|;|\s)application\/pdf\b/i.test(page.contentType) || /\.pdf(?:[?#].*)?$/i.test(page.url)) {
    return "PDF";
  }
  return "OTHER";
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
