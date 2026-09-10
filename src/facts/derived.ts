import type { SiteType } from "@/db/schema";
import type { CrawledPage } from "@/scanner/crawl/types";
import type { ExtractedFact } from "./extractors/types";

export function deriveRuntimeFacts(input: {
  facts: ExtractedFact[];
  pages: CrawledPage[];
  startUrl: string;
  siteType: SiteType;
}): ExtractedFact[] {
  const derived: ExtractedFact[] = [];
  const pageStatusByUrl = new Map(input.pages.map((page) => [normalizeUrl(page.url), page.status]));
  const crawlComplete = hasCompleteCoverage(input.facts);

  deriveAccessibilityFacts(derived, input.facts, pageStatusByUrl, "privacy_policy_url", "policy_url_accessible");
  deriveAccessibilityFacts(derived, input.facts, pageStatusByUrl, "offer_url", "offer_accessible");

  if (input.siteType === "ECOMMERCE") {
    derived.push(booleanFact("remote_sale_detected", true, input.startUrl, "site_type=ECOMMERCE"));
  }

  const sellerKind = deriveSellerKind(input.facts);
  if (sellerKind) {
    derived.push({
      factType: "seller_kind",
      value: { kind: sellerKind, confidence: "HIGH" },
      evidence: [
        {
          evidenceType: "TEXT_FRAGMENT",
          pageUrl: input.startUrl,
          payload: { kind: "seller_kind", context: `Derived from explicit ${sellerKind} requisites candidates.` }
        }
      ]
    });
  }

  if (sellerKind) {
    pushPresenceOrCoveredAbsence(derived, input.facts, "legal_name_found", "seller_legal_name_candidate", input.startUrl, crawlComplete);
    pushPresenceOrCoveredAbsence(derived, input.facts, "ogrn_found", "ogrn_candidate", input.startUrl, crawlComplete);
    pushPresenceOrCoveredAbsence(derived, input.facts, "ogrnip_found", "ogrnip_candidate", input.startUrl, crawlComplete);
    pushPresenceOrCoveredAbsence(derived, input.facts, "seller_address_found", "seller_address_candidate", input.startUrl, crawlComplete);
    pushPresenceOrCoveredAbsence(derived, input.facts, "seller_fio_found", "seller_fio_candidate", input.startUrl, crawlComplete);
    pushPresenceOrCoveredAbsence(derived, input.facts, "ip_registration_info_found", "ogrnip_candidate", input.startUrl, crawlComplete);

    if (crawlComplete) {
      derived.push(booleanFact("seller_email_found", hasFact(input.facts, "seller_email_found"), input.startUrl));
      derived.push(booleanFact("seller_phone_found", hasFact(input.facts, "seller_phone_found"), input.startUrl));
      derived.push(
        booleanFact(
          "legal_name_or_address_or_working_hours_missing",
          !hasFact(input.facts, "seller_legal_name_candidate") ||
            !hasFact(input.facts, "seller_address_candidate") ||
            !hasFact(input.facts, "working_hours_candidate"),
          input.startUrl
        )
      );
    } else if (
      hasFact(input.facts, "seller_legal_name_candidate") &&
      hasFact(input.facts, "seller_address_candidate") &&
      hasFact(input.facts, "working_hours_candidate")
    ) {
      derived.push(booleanFact("legal_name_or_address_or_working_hours_missing", false, input.startUrl));
    }
  }

  const priceFound = hasFact(input.facts, "price_occurrence");
  if (priceFound || crawlComplete) {
    derived.push(booleanFact("price_found", priceFound, input.startUrl));
  }
  if ((input.siteType === "ECOMMERCE" || input.siteType === "B2C_SERVICE") && priceFound) {
    derived.push(booleanFact("consumer_offer_detected", true, input.startUrl, "site_type + price_occurrence"));
  }

  return derived;
}

function pushPresenceOrCoveredAbsence(
  target: ExtractedFact[],
  facts: ExtractedFact[],
  derivedFactType: ExtractedFact["factType"],
  sourceFactType: ExtractedFact["factType"],
  pageUrl: string,
  crawlComplete: boolean
): void {
  const found = hasFact(facts, sourceFactType);
  if (found || crawlComplete) {
    target.push(booleanFact(derivedFactType, found, pageUrl));
  }
}

function deriveAccessibilityFacts(
  target: ExtractedFact[],
  facts: ExtractedFact[],
  pageStatusByUrl: Map<string, number>,
  sourceFactType: ExtractedFact["factType"],
  targetFactType: ExtractedFact["factType"]
): void {
  const urls = facts
    .filter((fact) => fact.factType === sourceFactType && typeof fact.value.url === "string")
    .map((fact) => String(fact.value.url));

  for (const url of new Set(urls)) {
    const status = pageStatusByUrl.get(normalizeUrl(url));
    if (status === undefined) {
      continue;
    }

    target.push({
      factType: targetFactType,
      value: { url, accessible: status >= 200 && status < 400, status },
      evidence: [
        {
          evidenceType: "TEXT_FRAGMENT",
          pageUrl: url,
          payload: { kind: targetFactType, url, status }
        }
      ]
    });
  }
}

function deriveSellerKind(facts: ExtractedFact[]): "LEGAL_ENTITY" | "INDIVIDUAL_ENTREPRENEUR" | undefined {
  const hasOgrn = hasFact(facts, "ogrn_candidate");
  const hasOgrnip = hasFact(facts, "ogrnip_candidate");
  const hasLegalEntityMarker = facts.some(
    (fact) =>
      fact.factType === "seller_legal_name_candidate" &&
      typeof fact.value.value === "string" &&
      /^(ООО|АО|ПАО|ЗАО)(?:\s|$)/u.test(fact.value.value)
  );
  const hasIpMarker = facts.some(
    (fact) =>
      fact.factType === "seller_fio_candidate" &&
      typeof fact.value.value === "string" &&
      /^ИП(?:\s|$)/u.test(fact.value.value)
  );

  if ((hasOgrn || hasLegalEntityMarker) && !hasOgrnip) {
    return "LEGAL_ENTITY";
  }

  if ((hasOgrnip || hasIpMarker) && !hasOgrn) {
    return "INDIVIDUAL_ENTREPRENEUR";
  }

  return undefined;
}

function booleanFact(
  factType: ExtractedFact["factType"],
  found: boolean,
  pageUrl: string,
  context?: string
): ExtractedFact {
  return {
    factType,
    value: { found },
    evidence: [
      {
        evidenceType: "TEXT_FRAGMENT",
        pageUrl,
        payload: { kind: factType, context: context ?? `Derived fact ${factType}=${found}` }
      }
    ]
  };
}

function hasFact(facts: ExtractedFact[], factType: ExtractedFact["factType"]): boolean {
  return facts.some((fact) => fact.factType === factType);
}

function hasCompleteCoverage(facts: ExtractedFact[]): boolean {
  return facts.some(
    (fact) =>
      fact.factType === "scan_coverage" &&
      fact.value.crawlCompleted === true &&
      fact.value.contentLimited !== true
  );
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}
