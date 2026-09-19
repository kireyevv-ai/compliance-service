import type { Browser, BrowserContext, Page, Request, Route } from "playwright-core";
import type { ExtractedEvidence, ExtractedFact, StaticExtractionResult } from "@/facts/extractors/types";
import type { CrawledPage } from "@/scanner/crawl/types";
import { normalizeUserUrl, type NormalizedUrl } from "@/scanner/normalization/url";
import { dnsHostResolver, type HostResolver } from "@/scanner/url-safety/resolver";
import { assertUrlIsSafe } from "@/scanner/url-safety/url-safety";
import { DEFAULT_BROWSER_AUDIT_CONFIG, type BrowserAuditConfig } from "./config";
import { launchBrowser } from "./browser-runtime";
import { isCheckoutLikePage, selectBrowserAuditPages } from "./page-selection";
import { abortError } from "@/jobs/scan-deadline";

export interface BrowserAuditOptions {
  config?: Partial<BrowserAuditConfig>;
  resolver?: HostResolver;
  browser?: Browser;
  routeHandler?: (route: Route) => Promise<void>;
  signal?: AbortSignal;
}

type NetworkObservation = {
  hostname: string;
  resourceType: string;
  relation: "FIRST_PARTY" | "OTHER_HOST";
  sanitizedUrl: string;
};

const PERSONAL_DATA_RE = /(fio|fullname|full_name|name|имя|фио|фамил|email|e-mail|mail|почт|phone|tel|mobile|телефон|моб|address|addr|адрес|birth|birthday|date_of_birth|дата рождения|рождени)/i;
const CONSENT_RE = /(соглас|персональн|обработк|конфиденциальн|privacy|policy)/i;
const PD_CONSENT_RE = /(персональн|обработк.*данн|данн.*обработк)/i;
const MARKETING_RE = /(маркетинг|реклам|рассыл|подписк|новост|акци|спецпредлож|marketing|subscribe|newsletter)/i;
const AUTH_PROVIDER_RE = /(войти через|продолжить с|sign in with|login with|google|yandex|яндекс|vk|вконтакте|gosuslugi|госуслуг)/i;
const PAID_ADDON_RE = /(страховк|гаранти|расширенн|дополнительн|addon|add-on|extra|платн|защита|сервисный пакет)/i;

export async function runBrowserAudit(
  input: {
    pages: CrawledPage[];
    staticExtraction: StaticExtractionResult;
    startUrl: string;
  },
  options: BrowserAuditOptions = {}
): Promise<StaticExtractionResult> {
  const config: BrowserAuditConfig = { ...DEFAULT_BROWSER_AUDIT_CONFIG, ...options.config };
  const normalized = normalizeUserUrl(input.startUrl);
  const resolver = options.resolver ?? dnsHostResolver;
  const targetUrls = selectBrowserAuditPages({
    pages: input.pages,
    staticExtraction: input.staticExtraction,
    startUrl: input.startUrl,
    config
  });
  const deadline = Date.now() + config.totalBrowserAuditTimeoutMs;
  const facts: ExtractedFact[] = [];
  const failures: Array<{ url: string; reason: string }> = [];
  let browser = options.browser;
  let ownsBrowser = false;
  let context: BrowserContext | undefined;
  const closeOnAbort = () => {
    void context?.close().catch(() => undefined);
    if (ownsBrowser) {
      void browser?.close().catch(() => undefined);
    }
  };

  if (targetUrls.length === 0) {
    facts.push(browserCoverageFact(input.startUrl, targetUrls, 0, failures));
    return { facts };
  }

  try {
    throwIfAborted(options.signal);
    if (!browser) {
      browser = await launchBrowser();
      ownsBrowser = true;
    }

    context = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: false });
    options.signal?.addEventListener("abort", closeOnAbort, { once: true });

    let completed = 0;
    for (const url of targetUrls) {
      const aborted = abortError(options.signal);
      if (aborted) {
        failures.push({ url, reason: aborted.message });
        break;
      }
      if (Date.now() > deadline) {
        failures.push({ url, reason: "Total browser audit timeout" });
        break;
      }

      try {
        facts.push(...(await auditOnePage(context, url, normalized, resolver, config, options.routeHandler, options.signal)));
        completed += 1;
      } catch (error) {
        failures.push({ url, reason: error instanceof Error ? error.message.slice(0, 160) : "Browser page audit failed" });
      }
    }

    facts.push(browserCoverageFact(input.startUrl, targetUrls, completed, failures));
    return { facts };
  } finally {
    options.signal?.removeEventListener("abort", closeOnAbort);
    await context?.close().catch(() => undefined);
    if (ownsBrowser) {
      await browser?.close().catch(() => undefined);
    }
  }
}

async function auditOnePage(
  context: BrowserContext,
  url: string,
  normalized: NormalizedUrl,
  resolver: HostResolver,
  config: BrowserAuditConfig,
  routeHandler?: (route: Route) => Promise<void>,
  signal?: AbortSignal
): Promise<ExtractedFact[]> {
  throwIfAborted(signal);
  await assertNavigableUrl(url, normalized, resolver);
  const page = await context.newPage();
  const observations = new Map<string, NetworkObservation>();

  page.on("popup", (popup) => {
    void popup.close().catch(() => undefined);
  });
  page.on("download", (download) => {
    void download.cancel().catch(() => undefined);
  });
  page.on("request", (request) => {
    observeRequest(request, normalized, observations, config);
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = request.url();

    if (request.isNavigationRequest()) {
      try {
        await assertNavigableUrl(requestUrl, normalized, resolver);
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
    }

    try {
      await assertUrlIsSafe(requestUrl, resolver);
    } catch {
      await route.abort("blockedbyclient");
      return;
    }

    if (routeHandler) {
      try {
        await withAbort(routeHandler(route), signal, () => route.abort("blockedbyclient").catch(() => undefined));
      } catch (error) {
        if (abortError(signal)) {
          await route.abort("blockedbyclient").catch(() => undefined);
          return;
        }
        throw error;
      }
      return;
    }

    await route.continue();
  });

  try {
    throwIfAborted(signal);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs
    });
    const finalUrl = response?.url() ?? page.url();
    await assertNavigableUrl(finalUrl, normalized, resolver);
    throwIfAborted(signal);
    await page.waitForTimeout(config.settleDelayMs);
    throwIfAborted(signal);
    return await extractRenderedFacts(page, url, observations, config);
  } finally {
    await page.close().catch(() => undefined);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  const error = abortError(signal);
  if (error) {
    throw error;
  }
}

function withAbort<T>(operation: Promise<T>, signal?: AbortSignal, onAbort?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = abortError(signal);
    if (aborted) {
      reject(aborted);
      return;
    }

    const abort = () => {
      onAbort?.();
      reject(abortError(signal) ?? new Error("Operation aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    operation.then(
      (result) => {
        signal?.removeEventListener("abort", abort);
        resolve(result);
      },
      (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

async function extractRenderedFacts(
  page: Page,
  pageUrl: string,
  observations: Map<string, NetworkObservation>,
  config: BrowserAuditConfig
): Promise<ExtractedFact[]> {
  await page.evaluate("globalThis.__name = globalThis.__name || ((value) => value)");
  const rendered = await page.evaluate(() => {
    function textOf(element: Element | null): string {
      return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
    }

    function labelFor(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
      const explicit = control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
      return textOf(explicit) || textOf(control.closest("label")) || control.getAttribute("aria-label") || control.getAttribute("title") || "";
    }

    const forms = Array.from(document.querySelectorAll("form")).map((form, formIndex) => ({
      formIndex,
      action: form.getAttribute("action") || (form as HTMLFormElement).action || "",
      method: ((form.getAttribute("method") || (form as HTMLFormElement).method || "get") as string).toLowerCase(),
      text: textOf(form).slice(0, 800),
      fields: Array.from(form.querySelectorAll("input, textarea, select")).map((field) => {
        const control = field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const input = field as HTMLInputElement;
        const tag = field.tagName.toLowerCase();
        const type = tag === "input" ? (input.type || "text").toLowerCase() : tag;
        return {
          tag,
          type,
          name: control.getAttribute("name") || "",
          id: control.id || "",
          label: labelFor(control),
          placeholder: control.getAttribute("placeholder") || "",
          autocomplete: control.getAttribute("autocomplete") || "",
          required: control.hasAttribute("required"),
          checked: type === "checkbox" || type === "radio" ? Boolean(input.checked) : undefined,
          outerHtml: field.outerHTML.slice(0, 700),
          nearbyText: textOf(field.closest("label, p, div, li, form")).slice(0, 800),
          links: Array.from((field.closest("label, p, div, li, form") || form).querySelectorAll("a[href]")).map((anchor) => ({
            href: anchor.getAttribute("href") || "",
            text: textOf(anchor).slice(0, 200)
          }))
        };
      }),
      outerHtml: form.outerHTML.slice(0, 1200)
    }));

    const scripts = Array.from(document.querySelectorAll("script[src]")).map((script) => (script as HTMLScriptElement).src);
    const iframes = Array.from(document.querySelectorAll("iframe[src]")).map((iframe) => (iframe as HTMLIFrameElement).src);
    const localStorageKeys = Array.from({ length: localStorage.length }, (_value, index) => localStorage.key(index)).filter(Boolean);
    const sessionStorageKeys = Array.from({ length: sessionStorage.length }, (_value, index) => sessionStorage.key(index)).filter(Boolean);
    const authCandidates = Array.from(document.querySelectorAll("a, button, [role='button'], input[type='button'], input[type='submit']")).map((element) => ({
      text: textOf(element) || (element as HTMLInputElement).value || element.getAttribute("aria-label") || "",
      href: element instanceof HTMLAnchorElement ? element.href : "",
      outerHtml: element.outerHTML.slice(0, 700)
    }));

    return { forms, scripts, iframes, localStorageKeys, sessionStorageKeys, authCandidates };
  });

  const facts: ExtractedFact[] = [];
  const cookies = await page.context().cookies(pageUrl);

  for (const form of rendered.forms) {
    const evidence = browserStateEvidence(pageUrl, {
      kind: "rendered_form",
      formIndex: form.formIndex,
      fragment: form.outerHtml
    });
    facts.push({
      pageUrl,
      factType: "rendered_form_found",
      value: { found: true, formIndex: form.formIndex, action: resolveUrl(form.action, pageUrl), method: form.method, fieldCount: form.fields.length },
      evidence: [evidence]
    });

    const personalFields = form.fields.filter((field) =>
      PERSONAL_DATA_RE.test([field.type, field.name, field.id, field.label, field.placeholder, field.autocomplete].join(" "))
    );
    if (personalFields.length > 0) {
      facts.push({
        pageUrl,
        factType: "rendered_personal_data_collection_found",
        value: {
          found: true,
          formIndex: form.formIndex,
          fields: personalFields.map((field) => ({
            type: field.type,
            name: field.name,
            id: field.id,
            label: field.label,
            placeholder: field.placeholder,
            autocomplete: field.autocomplete,
            required: field.required
          }))
        },
        evidence: [evidence]
      });
    }

    const actionUrl = resolveUrl(form.action, pageUrl);
    if (actionUrl) {
      facts.push({
        pageUrl,
        factType: "rendered_form_action_target",
        value: { formIndex: form.formIndex, actionUrl, method: form.method, host: hostOf(actionUrl), externalToPageHost: hostOf(actionUrl) !== hostOf(pageUrl) },
        evidence: [evidence]
      });
    }

    for (const [controlIndex, field] of form.fields.entries()) {
      const nearbyText = compact([field.label, field.nearbyText].filter(Boolean).join(" "), 800);
      const isConsent = CONSENT_RE.test(nearbyText);
      const isMarketing = MARKETING_RE.test(nearbyText);
      const isCheckable = field.type === "checkbox" || field.type === "radio";
      if (!isCheckable || (!isConsent && !isMarketing)) {
        continue;
      }

      const links = field.links
        .map((link) => ({ url: resolveUrl(link.href, pageUrl), text: link.text }))
        .filter((link): link is { url: string; text: string } => Boolean(link.url));
      const controlEvidence = browserStateEvidence(pageUrl, {
        kind: "rendered_control",
        formIndex: form.formIndex,
        controlIndex,
        context: nearbyText,
        fragment: field.outerHtml
      });

      if (isConsent) {
        facts.push({
          pageUrl,
          factType: "rendered_consent_control_found",
          value: { found: true, formIndex: form.formIndex, controlIndex, personalDataConsent: PD_CONSENT_RE.test(nearbyText) },
          evidence: [controlEvidence]
        });
        facts.push({
          pageUrl,
          factType: "rendered_consent_checked",
          value: { checked: Boolean(field.checked), formIndex: form.formIndex, controlIndex },
          evidence: [controlEvidence]
        });
        facts.push({
          pageUrl,
          factType: "rendered_consent_text",
          value: { formIndex: form.formIndex, controlIndex, text: nearbyText, links },
          evidence: [browserStateEvidence(pageUrl, { kind: "rendered_consent_text", context: nearbyText, links })]
        });
      }

      if (isMarketing) {
        facts.push({
          pageUrl,
          factType: "rendered_marketing_consent_found",
          value: { found: true, formIndex: form.formIndex, controlIndex },
          evidence: [controlEvidence]
        });
        facts.push({
          pageUrl,
          factType: "rendered_marketing_consent_checked",
          value: { checked: Boolean(field.checked), formIndex: form.formIndex, controlIndex },
          evidence: [controlEvidence]
        });
      }
    }

    if (isCheckoutLikePage(pageUrl)) {
      for (const [controlIndex, field] of form.fields.entries()) {
        const nearbyText = compact([field.label, field.nearbyText].filter(Boolean).join(" "), 800);
        if ((field.type === "checkbox" || field.type === "radio") && PAID_ADDON_RE.test(nearbyText)) {
          const evidence = browserStateEvidence(pageUrl, {
            kind: "paid_addon_control",
            formIndex: form.formIndex,
            controlIndex,
            context: nearbyText,
            fragment: field.outerHtml
          });
          facts.push({
            pageUrl,
            factType: "paid_addon_control_found",
            value: { found: true, formIndex: form.formIndex, controlIndex },
            evidence: [evidence]
          });
          if (field.checked) {
            facts.push({
              pageUrl,
              factType: "paid_addon_preselected",
              value: { preselected: true, formIndex: form.formIndex, controlIndex },
              evidence: [evidence]
            });
          }
        }
      }
    }
  }

  const networkHosts = [...observations.values()].slice(0, config.maxNetworkObservationsPerPage);
  if (networkHosts.length > 0) {
    facts.push({
      pageUrl,
      factType: "network_request_hosts",
      value: { requests: networkHosts },
      evidence: [networkEvidence(pageUrl, { requests: networkHosts })]
    });
  }

  pushUrlListFact(facts, pageUrl, "script_sources_rendered", rendered.scripts);
  pushUrlListFact(facts, pageUrl, "iframe_sources_rendered", rendered.iframes);

  if (cookies.length > 0) {
    facts.push({
      pageUrl,
      factType: "cookie_metadata",
      value: {
        cookies: cookies.map((cookie) => ({
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite
        }))
      },
      evidence: [browserStateEvidence(pageUrl, { kind: "cookie_metadata", cookieNames: cookies.map((cookie) => cookie.name) })]
    });
  }

  if (rendered.localStorageKeys.length > 0) {
    facts.push({
      pageUrl,
      factType: "local_storage_keys",
      value: { keys: rendered.localStorageKeys },
      evidence: [browserStateEvidence(pageUrl, { kind: "local_storage_keys", keys: rendered.localStorageKeys })]
    });
  }

  if (rendered.sessionStorageKeys.length > 0) {
    facts.push({
      pageUrl,
      factType: "session_storage_keys",
      value: { keys: rendered.sessionStorageKeys },
      evidence: [browserStateEvidence(pageUrl, { kind: "session_storage_keys", keys: rendered.sessionStorageKeys })]
    });
  }

  const authCandidates = rendered.authCandidates.filter((candidate) =>
    AUTH_PROVIDER_RE.test([candidate.text, candidate.href].join(" "))
  );
  if (authCandidates.length > 0) {
    facts.push({
      pageUrl,
      factType: "auth_provider_candidates_rendered",
      value: {
        candidates: authCandidates.map((candidate) => ({
          text: compact(candidate.text, 200),
          href: sanitizeUrl(candidate.href),
          hostname: hostOf(candidate.href)
        }))
      },
      evidence: authCandidates.map((candidate) =>
        browserStateEvidence(pageUrl, { kind: "auth_provider_candidate", text: candidate.text, href: sanitizeUrl(candidate.href), fragment: candidate.outerHtml })
      )
    });
  }

  return facts;
}

function observeRequest(
  request: Request,
  normalized: NormalizedUrl,
  observations: Map<string, NetworkObservation>,
  config: BrowserAuditConfig
): void {
  if (observations.size >= config.maxNetworkObservationsPerPage) {
    return;
  }

  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    return;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }

  const hostname = url.hostname.toLowerCase();
  const uniqueHosts = new Set([...observations.values()].map((item) => item.hostname));
  if (!uniqueHosts.has(hostname) && uniqueHosts.size >= config.maxUniqueHostsPerPage) {
    return;
  }

  const key = `${hostname}|${request.resourceType()}|${sanitizeUrl(url.toString())}`;
  observations.set(key, {
    hostname,
    resourceType: request.resourceType(),
    relation: normalized.allowedHosts.includes(hostname) ? "FIRST_PARTY" : "OTHER_HOST",
    sanitizedUrl: sanitizeUrl(url.toString())
  });
}

function pushUrlListFact(
  facts: ExtractedFact[],
  pageUrl: string,
  factType: ExtractedFact["factType"],
  urls: string[]
): void {
  const items = unique(urls)
    .map((url) => ({ url: sanitizeUrl(url), hostname: hostOf(url) }))
    .filter((item) => item.url && item.hostname);

  if (items.length === 0) {
    return;
  }

  facts.push({
    pageUrl,
    factType,
    value: { sources: items },
    evidence: [browserStateEvidence(pageUrl, { kind: factType, sources: items })]
  });
}

async function assertNavigableUrl(url: string, normalized: NormalizedUrl, resolver: HostResolver): Promise<void> {
  const parsed = new URL(url);
  if (!normalized.allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error("Browser navigation outside crawl scope blocked");
  }

  await assertUrlIsSafe(parsed, resolver);
}

function browserCoverageFact(
  startUrl: string,
  attemptedUrls: string[],
  completed: number,
  failures: Array<{ url: string; reason: string }>
): ExtractedFact {
  return {
    factType: "browser_audit_coverage",
    value: {
      attempted: attemptedUrls.length,
      completed,
      failed: failures.length,
      failures
    },
    evidence: [
      {
        evidenceType: "BROWSER_STATE",
        pageUrl: startUrl,
        payload: {
          kind: "browser_audit_coverage",
          attemptedUrls,
          completed,
          failed: failures.length
        }
      }
    ]
  };
}

function browserStateEvidence(pageUrl: string, payload: Record<string, unknown>): ExtractedEvidence {
  return { evidenceType: "BROWSER_STATE", pageUrl, payload };
}

function networkEvidence(pageUrl: string, payload: Record<string, unknown>): ExtractedEvidence {
  return { evidenceType: "NETWORK_OBSERVATION", pageUrl, payload };
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

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.search = url.search ? "?[redacted]" : "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function hostOf(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function compact(value: string, max = 500): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > max ? `${compacted.slice(0, max - 1)}…` : compacted;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
