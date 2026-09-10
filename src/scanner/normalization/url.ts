export interface NormalizedUrl {
  canonicalStartUrl: string;
  normalizedDomain: string;
  startHost: string;
  allowedHosts: string[];
}

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeUserUrl(input: string): NormalizedUrl {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("URL is required");
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Malformed URL");
  }

  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    throw new Error("Unsupported URL scheme");
  }

  if (!url.hostname) {
    throw new Error("Malformed URL");
  }

  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if (!url.pathname) {
    url.pathname = "/";
  }

  const startHost = url.hostname;
  const normalizedDomain = stripLeadingWww(startHost);
  const allowedHosts = Array.from(new Set([startHost, normalizedDomain, `www.${normalizedDomain}`]));

  return {
    canonicalStartUrl: url.toString(),
    normalizedDomain,
    startHost,
    allowedHosts
  };
}

export function stripLeadingWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}
