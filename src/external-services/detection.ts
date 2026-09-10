import type { ExtractedEvidence, ExtractedFact, StaticExtractionResult } from "@/facts/extractors/types";
import { normalizeUserUrl } from "@/scanner/normalization/url";
import { enabledExternalServices, loadExternalServicesCatalog } from "./catalog";
import type { ExternalServiceDefinition } from "./schema";

export type ExternalServiceSignalType = "NETWORK" | "SCRIPT" | "IFRAME" | "FORM_ACTION";

export interface ExternalServiceDetectionConfig {
  maxUnmatchedObservationsPerScan: number;
}

export const DEFAULT_EXTERNAL_SERVICE_DETECTION_CONFIG: ExternalServiceDetectionConfig = {
  maxUnmatchedObservationsPerScan: 50
};

type Observation = {
  pageUrl: string;
  signalType: ExternalServiceSignalType;
  host: string;
  sanitizedUrl?: string;
  path: string;
};

type ServiceMatch = {
  service_id: string;
  service_name: string;
  category: string;
  matched_host: string;
  signal_type: ExternalServiceSignalType;
  matched_pattern: string;
  confidence: "HIGH" | "MEDIUM";
  provider_scope: string;
  page_url: string;
};

const CONFIDENCE_RANK = { MEDIUM: 1, HIGH: 2 } as const;

export function detectExternalServices(
  input: {
    facts: ExtractedFact[];
    startUrl: string;
    catalog?: ExternalServiceDefinition[];
    config?: Partial<ExternalServiceDetectionConfig>;
  }
): StaticExtractionResult {
  const config = { ...DEFAULT_EXTERNAL_SERVICE_DETECTION_CONFIG, ...input.config };
  const services = enabledExternalServices(input.catalog ?? loadExternalServicesCatalog());
  const normalized = normalizeUserUrl(input.startUrl);
  const observations = collectExternalObservations(input.facts, normalized.allowedHosts);
  const pageMatchMap = new Map<string, { match: ServiceMatch; observation: Observation }>();
  const unmatched = new Map<string, Observation>();

  for (const observation of observations) {
    const match = matchObservation(observation, services);
    if (match) {
      const key = [match.service_id, match.page_url, match.signal_type, match.matched_host].join("|");
      const existing = pageMatchMap.get(key);
      if (!existing || CONFIDENCE_RANK[match.confidence] > CONFIDENCE_RANK[existing.match.confidence]) {
        pageMatchMap.set(key, { match, observation });
      }
      continue;
    }

    if (unmatched.size < config.maxUnmatchedObservationsPerScan) {
      unmatched.set([observation.host, observation.signalType, observation.pageUrl].join("|"), observation);
    }
  }

  const matches = [...pageMatchMap.values()];
  const facts: ExtractedFact[] = matches.map(({ match, observation }) => ({
    pageUrl: match.page_url,
    factType: "external_service_matches",
    value: match,
    evidence: [matchEvidence(match, observation)]
  }));

  const summary = summarizeMatches(matches.map((item) => item.match));
  facts.push({
    factType: "external_service_detected",
    value: {
      detected: summary.length > 0,
      service_ids: summary.map((item) => item.service_id),
      service_count: summary.length,
      services: summary
    },
    evidence: [summaryEvidence(input.startUrl, "external_service_detected", summary)]
  });

  const foreignServiceIds = summary
    .filter((item) => item.provider_scope === "FOREIGN_PROVIDER")
    .map((item) => item.service_id);
  if (foreignServiceIds.length > 0) {
    facts.push({
      factType: "foreign_provider_signal_found",
      value: {
        found: true,
        service_ids: foreignServiceIds,
        note: "Technical foreign-provider catalog signal only; no legal conclusion."
      },
      evidence: [summaryEvidence(input.startUrl, "foreign_provider_signal_found", foreignServiceIds)]
    });
  }

  if (unmatched.size > 0) {
    const grouped = [...unmatched.values()].map((item) => ({
      host: item.host,
      signal_type: item.signalType,
      page_url: item.pageUrl
    }));
    facts.push({
      factType: "external_service_hosts_unmatched",
      value: { observations: grouped, limit: config.maxUnmatchedObservationsPerScan },
      evidence: [
        {
          evidenceType: "NETWORK_OBSERVATION",
          pageUrl: input.startUrl,
          payload: { kind: "external_service_hosts_unmatched", observations: grouped }
        }
      ]
    });
  }

  return { facts };
}

function collectExternalObservations(facts: ExtractedFact[], allowedHosts: string[]): Observation[] {
  const observations: Observation[] = [];
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));

  for (const fact of facts) {
    const pageUrl = fact.pageUrl;
    if (!pageUrl) {
      continue;
    }

    if (fact.factType === "network_request_hosts" && Array.isArray(fact.value.requests)) {
      for (const request of fact.value.requests) {
        pushObservation(observations, allowed, pageUrl, "NETWORK", request);
      }
    }

    if ((fact.factType === "script_sources_rendered" || fact.factType === "iframe_sources_rendered") && Array.isArray(fact.value.sources)) {
      const signalType = fact.factType === "script_sources_rendered" ? "SCRIPT" : "IFRAME";
      for (const source of fact.value.sources) {
        pushObservation(observations, allowed, pageUrl, signalType, source);
      }
    }

    if ((fact.factType === "form_action_target" || fact.factType === "rendered_form_action_target") && typeof fact.value.host === "string") {
      pushObservation(observations, allowed, pageUrl, "FORM_ACTION", {
        hostname: fact.value.host,
        host: fact.value.host,
        sanitizedUrl: fact.value.actionUrl,
        url: fact.value.actionUrl
      });
    }
  }

  return observations;
}

function pushObservation(
  observations: Observation[],
  allowedHosts: Set<string>,
  pageUrl: string,
  signalType: ExternalServiceSignalType,
  value: unknown
): void {
  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const rawHost = typeof record.hostname === "string" ? record.hostname : typeof record.host === "string" ? record.host : undefined;
  const rawUrl = typeof record.sanitizedUrl === "string" ? record.sanitizedUrl : typeof record.url === "string" ? record.url : undefined;
  const hostValue = rawHost ?? hostOf(rawUrl);
  const host = hostValue?.toLowerCase();

  if (!host || allowedHosts.has(host)) {
    return;
  }

  const sanitizedUrl = rawUrl ? sanitizeUrl(rawUrl) : undefined;
  observations.push({
    pageUrl,
    signalType,
    host,
    sanitizedUrl,
    path: pathOf(sanitizedUrl)
  });
}

function matchObservation(
  observation: Observation,
  services: ExternalServiceDefinition[]
): ServiceMatch | undefined {
  for (const service of services) {
    for (const domain of service.domains) {
      const domainMatch = hostMatches(observation.host, domain);
      if (!domainMatch) {
        continue;
      }

      if (service.path_hints?.length) {
        const matchedPath = service.path_hints.find((hint) => observation.path.includes(hint));
        if (!matchedPath) {
          continue;
        }

        return buildMatch(service, observation, `${domain}${matchedPath}`);
      }

      return buildMatch(service, observation, domain);
    }
  }

  return undefined;
}

function buildMatch(
  service: ExternalServiceDefinition,
  observation: Observation,
  matchedPattern: string
): ServiceMatch {
  return {
    service_id: service.service_id,
    service_name: service.name,
    category: service.category,
    matched_host: observation.host,
    signal_type: observation.signalType,
    matched_pattern: matchedPattern,
    confidence: service.confidence === "HIGH" ? "HIGH" : "MEDIUM",
    provider_scope: service.provider_scope,
    page_url: observation.pageUrl
  };
}

function summarizeMatches(matches: ServiceMatch[]): Array<{
  service_id: string;
  service_name: string;
  category: string;
  provider_scope: string;
  confidence: "HIGH" | "MEDIUM";
  signal_types: ExternalServiceSignalType[];
  matched_hosts: string[];
}> {
  const byService = new Map<string, ReturnType<typeof summarizeMatches>[number]>();

  for (const match of matches) {
    const existing = byService.get(match.service_id);
    if (!existing) {
      byService.set(match.service_id, {
        service_id: match.service_id,
        service_name: match.service_name,
        category: match.category,
        provider_scope: match.provider_scope,
        confidence: match.confidence,
        signal_types: [match.signal_type],
        matched_hosts: [match.matched_host]
      });
      continue;
    }

    if (CONFIDENCE_RANK[match.confidence] > CONFIDENCE_RANK[existing.confidence]) {
      existing.confidence = match.confidence;
    }
    existing.signal_types = unique([...existing.signal_types, match.signal_type]);
    existing.matched_hosts = unique([...existing.matched_hosts, match.matched_host]);
  }

  return [...byService.values()].sort((a, b) => a.service_id.localeCompare(b.service_id));
}

function matchEvidence(match: ServiceMatch, observation: Observation): ExtractedEvidence {
  return {
    evidenceType: observation.signalType === "NETWORK" ? "NETWORK_OBSERVATION" : "BROWSER_STATE",
    pageUrl: match.page_url,
    payload: {
      kind: "external_service_match",
      page_url: match.page_url,
      signal_type: match.signal_type,
      matched_host: match.matched_host,
      sanitized_url: observation.sanitizedUrl,
      matched_path: observation.path,
      service_id: match.service_id,
      matched_pattern: match.matched_pattern
    }
  };
}

function summaryEvidence(pageUrl: string, kind: string, summary: unknown): ExtractedEvidence {
  return {
    evidenceType: "TEXT_FRAGMENT",
    pageUrl,
    payload: { kind, summary }
  };
}

function hostMatches(host: string, domain: string): boolean {
  const normalizedDomain = domain.toLowerCase();
  if (normalizedDomain.startsWith("*.")) {
    const suffix = normalizedDomain.slice(1);
    return host.endsWith(suffix);
  }

  return host === normalizedDomain;
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

function pathOf(rawUrl: string | undefined): string {
  if (!rawUrl) {
    return "";
  }

  try {
    return new URL(rawUrl).pathname;
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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
