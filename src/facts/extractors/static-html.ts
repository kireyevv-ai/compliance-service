import * as cheerio from "cheerio";
import type { CrawledPage } from "@/scanner/crawl/types";
import type { ExtractedEvidence, ExtractedFact, StaticExtractionOptions, StaticExtractionResult } from "./types";
import { extractPolicyTextFacts } from "./policy-text";

type LinkCandidate = {
  url: string;
  pageUrl: string;
  text: string;
  href: string;
  title?: string;
  ariaLabel?: string;
  context: string;
};

type PageSignals = {
  hasPersonalDataCollection: boolean;
  hasPrivacyLink: boolean;
  hasOfferLink: boolean;
  hasRublePrice: boolean;
  hasMarketingSubscription: boolean;
};

type TextCandidate = {
  value: string;
  maskedValue?: string;
  context: string;
  pageUrl: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
};

type ContentLimitation = {
  contentLimited: boolean;
  limitationReason: string | null;
};

const PERSONAL_DATA_CATEGORIES = [
  { category: "name", pattern: /(fio|fullname|full_name|name|имя|фио|фамил)/i },
  { category: "email", pattern: /(email|e-mail|mail|почт)/i },
  { category: "phone", pattern: /(phone|tel|mobile|телефон|моб)/i },
  { category: "address", pattern: /(address|addr|адрес|улица|город)/i },
  { category: "dob", pattern: /(birth|birthday|date_of_birth|дата рождения|рождени)/i }
] as const;

const CONSENT_RE = /(соглас|персональн|обработк|конфиденциальн|privacy|policy)/i;
const PD_CONSENT_RE = /(персональн|обработк.*данн|данн.*обработк)/i;
const MARKETING_RE = /(маркетинг|реклам|рассыл|подписк|новост|акци|спецпредлож|marketing|subscribe|newsletter)/i;
const PRIVACY_RE = /(политик.*персон|политик.*конфиденциальн|персональн.*данн|соглас.*обработк.*персон|privacy|personal[-_\s]?data|policy)/i;
const GENERAL_OFFER_RE =
  /(публичн.*оферт|договор.*оферт|оферт.*договор|услови.*дистанционн.*продаж|услови.*продаж.*товар.*интернет-магазин|услови.*продаж.*интернет-магазин|public[-_\s]?offer|distance[-_\s]?sale.*terms|online[-_\s]?store.*terms)/i;
const SIMPLE_OFFER_URL_RE = /(?:^|\/)(?:offer|oferta|public-offer)(?:[./?#]|$)/i;
const SPECIALIZED_OFFER_RE =
  /(подарочн.*сертификат|электронн.*сертификат|подарочн.*карт|бонусн.*программ|программ.*лояльност|акци[яи]|промо|спецпредлож|сертификат|gift[-_\s]?(card|certificate)|bonus|loyalty|promo|promotion)/i;
const CONSUMER_TEXT_RE =
  /(претенз|жалоб|обращени|возврат|refund|return|claim|complaint|доставк|delivery|оплат|payment|услови|оферт|контакт|seller|продавец|исполнитель)/i;
const RECOMMENDATION_RULES_RE =
  /(правил.*рекомендательн|рекомендательн.*технолог|recommendation.*rules|recommender.*rules|recommendation.*technology)/i;
const DOCUMENT_EXT_RE = /\.(pdf|doc|docx)(?:[?#].*)?$/i;
const RUB_PRICE_RE = /((?:\d{1,3}(?:[\s\u00a0]\d{3})+|\d+)(?:[,.]\d{1,2})?)\s*(₽|руб\.?|рублей|RUB)(?=$|[\s.,;:!?<])/giu;
const FOREIGN_PRICE_RE = /((?:\d{1,3}(?:[\s\u00a0]\d{3})+|\d+)(?:[,.]\d{1,2})?)\s*(\$|€|USD|EUR)(?=$|[\s.,;:!?<])/giu;
const OGRN_RE = /ОГРН(?!ИП)[^\d]{0,30}([\d\s-]{13,25})/giu;
const OGRNIP_RE = /ОГРНИП[^\d]{0,30}([\d\s-]{15,30})/giu;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const PHONE_RE = /(?:\+7|8)\s*(?:\(?\d{3}\)?)[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/gu;
const LIMITED_URL_RE = /(captcha|challenge|verify[-_]?human|access[-_]?denied|forbidden|blocked|security[-_]?check|bot[-_]?check|vpn[-_]?che{0,2}ck)/i;
const LIMITED_TEXT_RE = /(captcha|verify\s+you\s+are\s+human|access\s+denied|automated\s+requests|security\s+check|bot\s+check|проверка\s+безопасности|подтвердите,\s*что\s+вы\s+человек|подтвердите\s+что\s+вы\s+человек|доступ\s+ограничен|доступ\s+запрещ[её]н|подозрительн[аяое]+\s+активност|защит[аы]\s+от\s+робот|ddos-guard)/i;

export function extractStaticFacts(
  pages: CrawledPage[],
  options: StaticExtractionOptions
): StaticExtractionResult {
  const facts: ExtractedFact[] = [];
  const privacyLinks: LinkCandidate[] = [];
  const offerLinks: LinkCandidate[] = [];
  const documentLinks: LinkCandidate[] = [];
  const signalsByPage = new Map<string, PageSignals>();
  const sellerCandidates = {
    legalNames: new Map<string, TextCandidate>(),
    ogrn: new Map<string, TextCandidate>(),
    ogrnip: new Map<string, TextCandidate>(),
    fio: new Map<string, TextCandidate>(),
    addresses: new Map<string, TextCandidate>(),
    emails: new Map<string, TextCandidate>(),
    phones: new Map<string, TextCandidate>(),
    hours: new Map<string, TextCandidate>()
  };

  for (const page of pages) {
    const $ = cheerio.load(page.html);
    const pageSignals: PageSignals = {
      hasPersonalDataCollection: false,
      hasPrivacyLink: false,
      hasOfferLink: false,
      hasRublePrice: false,
      hasMarketingSubscription: false
    };

    const links = extractLinks($, page.url);
    const pagePrivacyLinks = links.filter((link) => PRIVACY_RE.test(linkSignal(link)));
    const pageOfferLinks = links.filter(isGeneralOfferLink);
    const pageRecommendationRulesLinks = links.filter((link) => RECOMMENDATION_RULES_RE.test(linkSignal(link)));
    const pageDocumentLinks = links.filter((link) => DOCUMENT_EXT_RE.test(link.url));

    privacyLinks.push(...pagePrivacyLinks);
    offerLinks.push(...pageOfferLinks);
    documentLinks.push(...pageDocumentLinks);
    pageSignals.hasPrivacyLink = pagePrivacyLinks.length > 0;
    pageSignals.hasOfferLink = pageOfferLinks.length > 0;

    for (const link of pagePrivacyLinks) {
      facts.push(linkFact("privacy_policy_link_found", page.url, link, { found: true }));
      facts.push(linkFact("privacy_policy_url", undefined, link, { url: link.url }));
    }
    for (const link of pageOfferLinks) {
      facts.push(linkFact("offer_link_found", page.url, link, { found: true }));
      facts.push(linkFact("offer_url", undefined, link, { url: link.url }));
    }
    for (const link of pageRecommendationRulesLinks) {
      facts.push(linkFact("recommendation_rules_document_link", page.url, link, { found: true, url: link.url }));
    }
    if (pageDocumentLinks.length > 0) {
      facts.push({
        pageUrl: page.url,
        factType: "document_links",
        value: { links: pageDocumentLinks.map((link) => ({ url: link.url, text: link.text, href: link.href })) },
        evidence: pageDocumentLinks.map((link) => documentEvidence(link))
      });
    }

    extractFormFacts($, page, facts, pageSignals);
    extractConsumerPageTextFacts($, page, facts, pageRecommendationRulesLinks.map((link) => link.url));
    extractSellerFacts($, page.url, sellerCandidates);
    extractPriceFacts($, page.url, facts, pageSignals);

    signalsByPage.set(page.url, pageSignals);
  }

  for (const page of pages) {
    const signals = signalsByPage.get(page.url);
    if (!signals?.hasPersonalDataCollection) {
      continue;
    }

    facts.push({
      pageUrl: page.url,
      factType: "policy_access_from_collection_page",
      value: { found: signals.hasPrivacyLink },
      evidence: [
        textEvidence(page.url, {
          kind: "policy_access_from_collection_page",
          context: signals.hasPrivacyLink
            ? "A privacy/personal-data policy link was found on the collection page."
            : "No privacy/personal-data policy link was found in the static HTML of this collection page."
        })
      ]
    });
  }

  pushCandidateFacts(facts, sellerCandidates);
  facts.push(
    ...extractPolicyTextFacts(pages, unique(privacyLinks.map((link) => link.url)), {
      pageLimitations: policyPageLimitations(pages)
    })
  );
  pushCoverageAndCompletedAggregates(facts, pages, options, {
    privacyLinks,
    offerLinks,
    documentLinks,
    pageSignals: [...signalsByPage.values()]
  });

  return { facts };
}

function extractFormFacts(
  $: cheerio.CheerioAPI,
  page: CrawledPage,
  facts: ExtractedFact[],
  pageSignals: PageSignals
): void {
  const pageUrl = page.url;
  const completeness = semanticCompletenessForPage(page);
  $("form").each((index, formElement) => {
    const form = $(formElement);
    const actionRaw = form.attr("action")?.trim();
    const actionUrl = resolveUrl(actionRaw, pageUrl);
    const method = (form.attr("method") ?? "get").trim().toLowerCase();
    const formText = compactText(form.text(), 700);
    const formHtml = compactText($.html(formElement), 900);
    const fields = form.find("input, textarea, select").toArray().map((element) => {
      const field = $(element);
      const tag = element.tagName.toLowerCase();
      const id = field.attr("id")?.trim();
      const name = field.attr("name")?.trim();
      const type = tag === "input" ? (field.attr("type") ?? "text").toLowerCase() : tag;
      const label = findLabel($, field, id);
      const placeholder = field.attr("placeholder")?.trim();
      const autocomplete = field.attr("autocomplete")?.trim();
      const descriptor = [type, name, id, label, placeholder, autocomplete].filter(Boolean).join(" ");
      const personalDataCategories = classifyPersonalData(descriptor);

      return {
        tag,
        type,
        name,
        id,
        label,
        placeholder,
        autocomplete,
        required: field.is("[required]"),
        checkedStatic: (type === "checkbox" || type === "radio") && field.is("[checked]"),
        personalDataCategories
      };
    });

    const formEvidence = domEvidence(pageUrl, { selector: `form:eq(${index})`, fragment: formHtml, ...completeness });
    facts.push({
      pageUrl,
      factType: "form_found",
      value: { found: true, formIndex: index, action: actionUrl, method, fieldCount: fields.length },
      evidence: [formEvidence]
    });
    facts.push({
      pageUrl,
      factType: "form_fields",
      value: { formIndex: index, fields },
      evidence: [formEvidence]
    });

    if (actionUrl) {
      facts.push({
        pageUrl,
        factType: "form_action_target",
        value: {
          formIndex: index,
          actionUrl,
          method,
          host: safeHost(actionUrl),
          externalToPageHost: safeHost(actionUrl) !== safeHost(pageUrl)
        },
        evidence: [formEvidence]
      });
    }

    const hasPersonalData = fields.some((field) => field.personalDataCategories.length > 0);
    if (hasPersonalData) {
      pageSignals.hasPersonalDataCollection = true;
      facts.push({
        pageUrl,
        factType: "personal_data_collection_found",
        value: {
          found: true,
          formIndex: index,
          categories: unique(fields.flatMap((field) => field.personalDataCategories))
        },
        evidence: [formEvidence]
      });
    }

    if (MARKETING_RE.test(formText)) {
      pageSignals.hasMarketingSubscription = true;
      facts.push({
        pageUrl,
        factType: "marketing_subscription_detected",
        value: { found: true, formIndex: index },
        evidence: [textEvidence(pageUrl, { formIndex: index, context: formText })]
      });
    }

    form.find("input[type='checkbox'], input[type='radio']").each((controlIndex, controlElement) => {
      const control = $(controlElement);
      const nearbyText = compactText([
        findLabel($, control, control.attr("id")?.trim()),
        control.parent().text(),
        control.closest("label, p, div, li").text()
      ].join(" "), 700);
      const relatedLinks = control
        .closest("label, p, div, li, form")
        .find("a")
        .toArray()
        .map((link) => ({
          url: resolveUrl($(link).attr("href")?.trim(), pageUrl),
          text: compactText($(link).text(), 160)
        }))
        .filter((link): link is { url: string; text: string } => Boolean(link.url));

      if (!CONSENT_RE.test(nearbyText) && !MARKETING_RE.test(nearbyText)) {
        return;
      }

      const controlEvidence = domEvidence(pageUrl, {
        selector: `form:eq(${index}) input[type='${control.attr("type") ?? "checkbox"}']:eq(${controlIndex})`,
        fragment: compactText($.html(controlElement), 500),
        context: nearbyText,
        ...completeness
      });
      facts.push({
        pageUrl,
        factType: "consent_control_found",
        value: { found: true, formIndex: index, controlIndex },
        evidence: [controlEvidence]
      });
      facts.push({
        pageUrl,
        factType: "consent_text",
        value: { formIndex: index, controlIndex, text: nearbyText, links: relatedLinks },
        evidence: [textEvidence(pageUrl, { formIndex: index, controlIndex, context: nearbyText, links: relatedLinks })]
      });

      if (PD_CONSENT_RE.test(nearbyText)) {
        facts.push({
          pageUrl,
          factType: "pd_consent_control_found",
          value: { found: true, formIndex: index, controlIndex },
          evidence: [controlEvidence]
        });
      }
      if (MARKETING_RE.test(nearbyText)) {
        facts.push({
          pageUrl,
          factType: "marketing_consent_control_found",
          value: { found: true, formIndex: index, controlIndex },
          evidence: [controlEvidence]
        });
      }
      if (control.is("[checked]")) {
        facts.push({
          pageUrl,
          factType: "control_prechecked_static",
          value: { found: true, formIndex: index, controlIndex, provisional: true },
          evidence: [controlEvidence]
        });
      }
    });
  });
}

function extractConsumerPageTextFacts(
  $: cheerio.CheerioAPI,
  page: CrawledPage,
  facts: ExtractedFact[],
  recommendationRuleUrls: string[]
): void {
  const text = readablePageText($, 12_000);
  if (!text) {
    return;
  }

  const completeness = semanticCompletenessForPage(page);
  if (CONSUMER_TEXT_RE.test(text) || looksConsumerRelevantUrl(page.url)) {
    facts.push({
      pageUrl: page.url,
      factType: "consumer_page_text",
      value: { text, sourceUrl: page.url, ...completeness },
      evidence: [textEvidence(page.url, { kind: "consumer_page_text", text, sourceUrl: page.url, ...completeness })]
    });
  }

  const normalizedPageUrl = normalizeUrl(page.url);
  const normalizedRecommendationRuleUrls = recommendationRuleUrls
    .map(normalizeUrl)
    .filter((url): url is string => Boolean(url));
  const isRecommendationRulesPage =
    RECOMMENDATION_RULES_RE.test(text) ||
    (typeof normalizedPageUrl === "string" && normalizedRecommendationRuleUrls.includes(normalizedPageUrl));
  if (isRecommendationRulesPage) {
    facts.push({
      pageUrl: page.url,
      factType: "recommendation_rules_text",
      value: { text, sourceUrl: page.url, ...completeness },
      evidence: [textEvidence(page.url, { kind: "recommendation_rules_text", text, sourceUrl: page.url, ...completeness })]
    });
  }
}

function readablePageText($: cheerio.CheerioAPI, maxChars: number): string {
  const clone = $.root().clone();
  clone.find("script, style, noscript, template, svg").remove();
  const text = compactText(clone.text(), maxChars);
  return text;
}

function looksConsumerRelevantUrl(url: string): boolean {
  return /(offer|oferta|terms|return|refund|claim|complaint|delivery|payment|contacts?|vozvrat|oplata|dostavka|pretenz)/i.test(url);
}

function extractLinks($: cheerio.CheerioAPI, pageUrl: string): LinkCandidate[] {
  const links: LinkCandidate[] = [];

  for (const element of $("a[href]").toArray()) {
      const anchor = $(element);
      const href = anchor.attr("href")?.trim() ?? "";
      const url = resolveUrl(href, pageUrl);
      if (!url) {
        continue;
      }

      links.push({
        url,
        pageUrl,
        href,
        text: compactText(anchor.text(), 220),
        title: anchor.attr("title")?.trim(),
        ariaLabel: anchor.attr("aria-label")?.trim(),
        context: compactText(anchor.parent().text(), 500)
      });
  }

  return links;
}

function isGeneralOfferLink(link: LinkCandidate): boolean {
  const signal = linkSignal(link);
  const specialized = SPECIALIZED_OFFER_RE.test(signal);
  const explicitGeneral = GENERAL_OFFER_RE.test(signal);
  const simpleOfferUrl = SIMPLE_OFFER_URL_RE.test(link.url) || SIMPLE_OFFER_URL_RE.test(link.href);

  if (specialized && !explicitGeneral) {
    return false;
  }

  return explicitGeneral || (!specialized && simpleOfferUrl);
}

function extractSellerFacts(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  candidates: {
    legalNames: Map<string, TextCandidate>;
    ogrn: Map<string, TextCandidate>;
    ogrnip: Map<string, TextCandidate>;
    fio: Map<string, TextCandidate>;
    addresses: Map<string, TextCandidate>;
    emails: Map<string, TextCandidate>;
    phones: Map<string, TextCandidate>;
    hours: Map<string, TextCandidate>;
  }
): void {
  const text = compactText(
    $("footer, [class*='contact' i], [id*='contact' i], [class*='requis' i], [id*='requis' i], [class*='legal' i], [id*='legal' i]")
      .text() || $("body").text(),
    5000
  );

  collectMarkerNumber(text, pageUrl, OGRNIP_RE, 15, candidates.ogrnip);
  collectMarkerNumber(text, pageUrl, OGRN_RE, 13, candidates.ogrn);

  const legalName = text.match(/(?:ООО|АО|ПАО|ЗАО)\s+[«"“]?[\p{Letter}\d .\-]+[»"”]?/u)?.[0];
  if (legalName) {
    putCandidate(candidates.legalNames, legalName, {
      value: compactText(legalName, 160),
      context: nearby(text, legalName),
      pageUrl,
      confidence: textHasRequisitesContext(text) ? "HIGH" : "MEDIUM"
    });
  }

  const fio = text.match(/ИП\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){1,2}/u)?.[0];
  if (fio) {
    putCandidate(candidates.fio, fio, {
      value: compactText(fio, 160),
      context: nearby(text, fio),
      pageUrl,
      confidence: textHasRequisitesContext(text) ? "HIGH" : "MEDIUM"
    });
  }

  const address = text.match(/(?:юридический\s+адрес|адрес|место\s+нахождения)[:\s]+.{10,180}/iu)?.[0];
  if (address) {
    putCandidate(candidates.addresses, address, {
      value: compactText(address, 220),
      context: nearby(text, address),
      pageUrl,
      confidence: textHasRequisitesContext(text) ? "HIGH" : "MEDIUM"
    });
  }

  const hours = text.match(/(?:режим|время|часы)\s+работы[:\s]+.{5,120}/iu)?.[0];
  if (hours) {
    putCandidate(candidates.hours, hours, {
      value: compactText(hours, 160),
      context: nearby(text, hours),
      pageUrl,
      confidence: "MEDIUM"
    });
  }

  for (const match of text.matchAll(EMAIL_RE)) {
    const value = match[0];
    putCandidate(candidates.emails, value.toLowerCase(), {
      value: "present",
      maskedValue: maskEmail(value),
      context: nearby(text, value),
      pageUrl,
      confidence: "HIGH"
    });
  }

  for (const match of text.matchAll(PHONE_RE)) {
    const value = match[0];
    putCandidate(candidates.phones, digitsOnly(value), {
      value: "present",
      maskedValue: maskPhone(value),
      context: nearby(text, value),
      pageUrl,
      confidence: "HIGH"
    });
  }
}

function extractPriceFacts(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  facts: ExtractedFact[],
  pageSignals: PageSignals
): void {
  const text = compactText($("body").text(), 8000);
  for (const match of [...text.matchAll(RUB_PRICE_RE), ...text.matchAll(FOREIGN_PRICE_RE)]) {
    const rawAmount = match[1];
    const marker = match[2];
    const amount = Number(rawAmount.replace(/[\s\u00a0]/g, "").replace(",", "."));
    const context = nearby(text, match[0]);
    const isRuble = /^(₽|руб\.?|рублей|RUB)$/iu.test(marker);

    facts.push({
      pageUrl,
      factType: "price_occurrence",
      value: { amount, currencyMarker: marker, isRuble, context },
      evidence: [textEvidence(pageUrl, { kind: "price_occurrence", context })]
    });

    if (isRuble) {
      pageSignals.hasRublePrice = true;
      facts.push({
        pageUrl,
        factType: "ruble_price_found",
        value: { found: true, amount, currencyMarker: marker },
        evidence: [textEvidence(pageUrl, { kind: "ruble_price_found", context })]
      });
    }
  }
}

function pushCandidateFacts(
  facts: ExtractedFact[],
  candidates: {
    legalNames: Map<string, TextCandidate>;
    ogrn: Map<string, TextCandidate>;
    ogrnip: Map<string, TextCandidate>;
    fio: Map<string, TextCandidate>;
    addresses: Map<string, TextCandidate>;
    emails: Map<string, TextCandidate>;
    phones: Map<string, TextCandidate>;
    hours: Map<string, TextCandidate>;
  }
): void {
  pushTextCandidateFacts(facts, "seller_legal_name_candidate", candidates.legalNames);
  pushTextCandidateFacts(facts, "ogrn_candidate", candidates.ogrn);
  pushTextCandidateFacts(facts, "ogrnip_candidate", candidates.ogrnip);
  pushTextCandidateFacts(facts, "seller_fio_candidate", candidates.fio);
  pushTextCandidateFacts(facts, "seller_address_candidate", candidates.addresses);
  pushTextCandidateFacts(facts, "seller_email_found", candidates.emails, true);
  pushTextCandidateFacts(facts, "seller_phone_found", candidates.phones, true);
  pushTextCandidateFacts(facts, "working_hours_candidate", candidates.hours);
}

function pushTextCandidateFacts(
  facts: ExtractedFact[],
  factType: ExtractedFact["factType"],
  candidates: Map<string, TextCandidate>,
  presenceOnly = false
): void {
  for (const candidate of candidates.values()) {
    facts.push({
      factType,
      value: presenceOnly
        ? { found: true, maskedValue: candidate.maskedValue, confidence: candidate.confidence }
        : { value: candidate.value, maskedValue: candidate.maskedValue, confidence: candidate.confidence },
      evidence: [
        textEvidence(candidate.pageUrl, {
          kind: factType,
          context: candidate.context
        })
      ]
    });
  }
}

function pushCoverageAndCompletedAggregates(
  facts: ExtractedFact[],
  pages: CrawledPage[],
  options: StaticExtractionOptions,
  collected: {
    privacyLinks: LinkCandidate[];
    offerLinks: LinkCandidate[];
    documentLinks: LinkCandidate[];
    pageSignals: PageSignals[];
  }
): void {
  const evidencePageUrl = options.startUrl ?? pages[0]?.url ?? "about:blank";
  const successfulHtmlPages = pages.filter(
    (page) => page.status >= 200 && page.status < 400 && page.html.trim().length > 0
  ).length;
  const httpErrorPages = pages.filter((page) => page.status >= 400 || page.status === 0).length;
  const limitation = detectContentLimitation(pages);
  const limitedPages = pages
    .filter((page) => page.contentLimited)
    .map((page) => ({
      url: page.url,
      reason: page.limitationReason ?? "CONTENT_LIMITED",
      responseBodyBytes: page.responseBodyBytes,
      responseBodyLimitBytes: page.responseBodyLimitBytes,
      declaredContentLength: page.declaredContentLength
    }));
  facts.push({
    factType: "scan_coverage",
    value: {
      crawlCompleted: options.crawlCompleted,
      pagesVisited: pages.length,
      successfulHtmlPages,
      httpErrorPages,
      maxPagesReached: Boolean(options.maxPagesReached),
      contentLimited: limitation.contentLimited,
      limitationReason: limitation.limitationReason,
      limitedPages
    },
    evidence: [
      textEvidence(evidencePageUrl, {
          kind: "scan_coverage",
          context: `Static extraction processed ${pages.length} crawled page(s). crawlCompleted=${options.crawlCompleted}; successfulHtmlPages=${successfulHtmlPages}; httpErrorPages=${httpErrorPages}; maxPagesReached=${Boolean(options.maxPagesReached)}; contentLimited=${limitation.contentLimited}.`
      })
    ]
  });

  if (!options.crawlCompleted || limitation.contentLimited) {
    return;
  }

  if (collected.privacyLinks.length === 0) {
    facts.push(siteBooleanFact("privacy_policy_link_found", false, evidencePageUrl, pages.length));
  }
  if (collected.offerLinks.length === 0) {
    facts.push(siteBooleanFact("offer_link_found", false, evidencePageUrl, pages.length));
  }
  if (collected.documentLinks.length > 0) {
    facts.push({
      factType: "document_links",
      value: { links: unique(collected.documentLinks.map((link) => link.url)).map((url) => ({ url })) },
      evidence: collected.documentLinks.slice(0, 5).map((link) => documentEvidence(link))
    });
  }

  const anyPersonalData = collected.pageSignals.some((signal) => signal.hasPersonalDataCollection);
  const anyMarketing = collected.pageSignals.some((signal) => signal.hasMarketingSubscription);
  const anyRublePrice = collected.pageSignals.some((signal) => signal.hasRublePrice);
  facts.push(siteBooleanFact("personal_data_collection_found", anyPersonalData, evidencePageUrl, pages.length));
  facts.push(siteBooleanFact("marketing_subscription_detected", anyMarketing, evidencePageUrl, pages.length));
  facts.push(siteBooleanFact("ruble_price_found", anyRublePrice, evidencePageUrl, pages.length));
}

function detectContentLimitation(pages: CrawledPage[]): ContentLimitation {
  for (const page of pages) {
    const limitation = detectPageContentLimitation(page);
    if (limitation.contentLimited) {
      return { contentLimited: true, limitationReason: limitation.limitationReason ?? "CONTENT_LIMITED" };
    }
  }

  return { contentLimited: false, limitationReason: null };
}

function policyPageLimitations(pages: CrawledPage[]): Map<string, ContentLimitation & { interstitialDetected: boolean }> {
  const map = new Map<string, ContentLimitation & { interstitialDetected: boolean }>();
  for (const page of pages) {
    const normalizedUrl = normalizeUrl(page.url);
    if (!normalizedUrl) {
      continue;
    }
    map.set(normalizedUrl, detectPageContentLimitation(page));
  }
  return map;
}

function detectPageContentLimitation(page: CrawledPage): ContentLimitation & { interstitialDetected: boolean } {
  if (page.contentLimited) {
    return {
      contentLimited: true,
      limitationReason: page.limitationReason ?? "CONTENT_LIMITED",
      interstitialDetected: false
    };
  }

  if (page.status === 403 || page.status === 429) {
    return { contentLimited: true, limitationReason: `HTTP ${page.status}`, interstitialDetected: true };
  }

  if (LIMITED_URL_RE.test(page.url)) {
    return { contentLimited: true, limitationReason: "Limited-content interstitial URL", interstitialDetected: true };
  }

  const $ = cheerio.load(page.html);
  const text = compactText([page.title, $("title").text(), $("body").text()].filter(Boolean).join(" "), 3000);
  if (LIMITED_TEXT_RE.test(text)) {
    return { contentLimited: true, limitationReason: "Limited-content interstitial text", interstitialDetected: true };
  }

  return { contentLimited: false, limitationReason: null, interstitialDetected: false };
}

function siteBooleanFact(
  factType: ExtractedFact["factType"],
  found: boolean,
  pageUrl: string,
  pagesChecked: number
): ExtractedFact {
  return {
    factType,
    value: { found, scope: "SITE", pagesChecked },
    evidence: [
      textEvidence(pageUrl, {
        kind: factType,
        context: `Site-level static aggregate after complete crawl. found=${found}; pagesChecked=${pagesChecked}.`
      })
    ]
  };
}

function linkFact(
  factType: ExtractedFact["factType"],
  pageUrl: string | undefined,
  link: LinkCandidate,
  value: Record<string, unknown>
): ExtractedFact {
  return {
    pageUrl,
    factType,
    value,
    evidence: [documentEvidence(link)]
  };
}

function documentEvidence(link: LinkCandidate): ExtractedEvidence {
  return {
    evidenceType: "DOCUMENT_REFERENCE",
    pageUrl: link.pageUrl,
    payload: {
      url: link.url,
      href: link.href,
      text: link.text,
      title: link.title,
      ariaLabel: link.ariaLabel,
      context: link.context
    }
  };
}

function domEvidence(pageUrl: string, payload: Record<string, unknown>): ExtractedEvidence {
  return { evidenceType: "DOM_FRAGMENT", pageUrl, payload };
}

function textEvidence(pageUrl: string, payload: Record<string, unknown>): ExtractedEvidence {
  return { evidenceType: "TEXT_FRAGMENT", pageUrl, payload };
}

function semanticCompletenessForPage(page: CrawledPage): Record<string, unknown> {
  return {
    semanticCompleteness:
      page.status >= 200 &&
      page.status < 300 &&
      /(?:^|;|\s)text\/html\b/i.test(page.contentType) &&
      page.contentLimited !== true
        ? "COMPLETE"
        : "PARTIAL",
    documentType: /(?:^|;|\s)text\/html\b/i.test(page.contentType) ? "HTML" : "OTHER",
    fetchStatus: page.status,
    fetchContentType: page.contentType,
    contentLimited: page.contentLimited === true,
    limitationReason: page.limitationReason,
    interstitialDetected: false,
    extractionSucceeded: true,
    extractionRoot: "body",
    extractionRootFallback: true,
    truncated: false,
    originalTextLength: page.html.length,
    maxChars: page.html.length
  };
}

function classifyPersonalData(descriptor: string): string[] {
  return PERSONAL_DATA_CATEGORIES.filter(({ pattern }) => pattern.test(descriptor)).map(({ category }) => category);
}

function findLabel($: cheerio.CheerioAPI, field: ReturnType<cheerio.CheerioAPI>, id?: string): string | undefined {
  const explicit = id ? $(`label[for="${cssEscape(id)}"]`).first().text() : "";
  const implicit = field.closest("label").text();
  const aria = field.attr("aria-label") ?? field.attr("title");
  return compactText(explicit || implicit || aria || "", 200) || undefined;
}

function linkSignal(link: LinkCandidate): string {
  return [link.text, link.href, link.title, link.ariaLabel].filter(Boolean).join(" ");
}

function collectMarkerNumber(
  text: string,
  pageUrl: string,
  regex: RegExp,
  length: number,
  target: Map<string, TextCandidate>
): void {
  for (const match of text.matchAll(regex)) {
    const digits = digitsOnly(match[1]);
    if (digits.length !== length) {
      continue;
    }

    putCandidate(target, digits, {
      value: digits,
      context: nearby(text, match[0]),
      pageUrl,
      confidence: "HIGH"
    });
  }
}

function putCandidate(map: Map<string, TextCandidate>, key: string, candidate: TextCandidate): void {
  if (!map.has(key)) {
    map.set(key, candidate);
  }
}

function textHasRequisitesContext(text: string): boolean {
  return /(реквизит|ОГРН|ОГРНИП|ИНН|КПП|юридический\s+адрес)/iu.test(text);
}

function resolveUrl(rawUrl: string | undefined, baseUrl: string): string | undefined {
  if (!rawUrl || rawUrl.startsWith("#") || /^(mailto|tel|javascript):/i.test(rawUrl)) {
    return undefined;
  }

  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return undefined;
  }
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

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function nearby(text: string, needle: string, radius = 180): string {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) {
    return compactText(text, radius * 2);
  }

  return compactText(text.slice(Math.max(0, index - radius), index + needle.length + radius), radius * 2);
}

function compactText(value: string, max = 500): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > max ? `${compacted.slice(0, max - 1)}…` : compacted;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!domain) {
    return "***";
  }
  return `${local.slice(0, 1)}***@${domain.toLowerCase()}`;
}

function maskPhone(value: string): string {
  const digits = digitsOnly(value);
  return digits.length >= 2 ? "+7 *** *** ** " + digits.slice(-2) : "+7 ***";
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
