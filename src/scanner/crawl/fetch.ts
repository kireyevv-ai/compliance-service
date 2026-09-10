import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";
import type { CrawlConfig } from "./config";
import { assertUrlIsSafe } from "@/scanner/url-safety/url-safety";
import { dnsHostResolver, type HostResolver, type ResolvedAddress } from "@/scanner/url-safety/resolver";
import { isBlockedIpAddress } from "@/scanner/url-safety/ip";

export interface FetchPageResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
  bodyLimited?: boolean;
  limitationReason?: string;
  bodyBytes?: number;
  maxBodyBytes?: number;
  declaredContentLength?: number;
}

export interface FetchTransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  bodyLimited?: boolean;
  limitationReason?: string;
  bodyBytes?: number;
  maxBodyBytes?: number;
}

export type FetchTransport = (
  url: URL,
  address: ResolvedAddress,
  config: CrawlConfig
) => Promise<FetchTransportResponse>;

export const RESPONSE_BODY_TOO_LARGE = "RESPONSE_BODY_TOO_LARGE";

export async function fetchPage(
  inputUrl: string,
  config: CrawlConfig,
  options: {
    resolver?: HostResolver;
    transport?: FetchTransport;
  } = {}
): Promise<FetchPageResponse> {
  return fetchPageWithRedirects(inputUrl, config, options.resolver ?? dnsHostResolver, options.transport ?? nodeTransport, 0);
}

async function fetchPageWithRedirects(
  inputUrl: string,
  config: CrawlConfig,
  resolver: HostResolver,
  transport: FetchTransport,
  redirectCount: number
): Promise<FetchPageResponse> {
  if (redirectCount > config.maxRedirects) {
    throw new Error("Too many redirects");
  }

  const safe = await assertUrlIsSafe(inputUrl, resolver);
  const address = safe.addresses[0];

  const response = await transport(safe.url, address, config);
  const location = response.headers.location;

  if (response.status >= 300 && response.status < 400 && location) {
    const redirectUrl = new URL(Array.isArray(location) ? location[0] : location, safe.url);
    return fetchPageWithRedirects(redirectUrl.toString(), config, resolver, transport, redirectCount + 1);
  }

  return {
    url: safe.url.toString(),
    status: response.status,
    contentType: headerValue(response.headers["content-type"]) ?? "",
    body: response.body,
    bodyLimited: response.bodyLimited,
    limitationReason: response.limitationReason,
    bodyBytes: response.bodyBytes,
    maxBodyBytes: response.maxBodyBytes,
    declaredContentLength: numberHeaderValue(response.headers["content-length"])
  };
}

function nodeTransport(
  url: URL,
  address: ResolvedAddress,
  config: CrawlConfig
): Promise<FetchTransportResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    let receivedBytes = 0;
    let settled = false;

    function resolveOnce(value: FetchTransportResponse) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    }

    const request = client.request(
      url,
      {
        method: "GET",
        timeout: config.requestTimeoutMs,
        headers: {
          "user-agent": "rf-website-compliance-mvp-crawler/0.1",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1"
        },
        lookup: createPinnedLookup(address)
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;

          if (receivedBytes > config.maxResponseBodyBytes) {
            resolveOnce({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: "",
              bodyLimited: true,
              limitationReason: RESPONSE_BODY_TOO_LARGE,
              bodyBytes: receivedBytes,
              maxBodyBytes: config.maxResponseBodyBytes
            });
            response.destroy();
            return;
          }

          chunks.push(chunk);
        });

        response.on("end", () => {
          resolveOnce({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            bodyBytes: receivedBytes,
            maxBodyBytes: config.maxResponseBodyBytes
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("HTTP request timeout"));
    });
    request.on("error", (error) => {
      if (!settled) {
        reject(error);
      }
    });
    request.end();
  });
}

type PinnedLookup = NonNullable<http.RequestOptions["lookup"]>;

export function createPinnedLookup(address: ResolvedAddress): PinnedLookup {
  return (
    _hostname: string,
    options: object | undefined,
    callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
  ) => {
    if (isBlockedIpAddress(address.address)) {
      callback(new Error("Hostname resolves to a blocked IP address"), "", 0);
      return;
    }

    if (typeof options === "object" && "all" in options && options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }

    callback(null, address.address, address.family);
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function numberHeaderValue(value: string | string[] | undefined): number | undefined {
  const rawValue = headerValue(value);
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}
