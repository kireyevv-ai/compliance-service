import { describe, expect, it } from "vitest";
import { fetchPage, type FetchTransport } from "@/scanner/crawl/fetch";
import { DEFAULT_CRAWL_CONFIG } from "@/scanner/crawl/config";
import { normalizeUserUrl } from "@/scanner/normalization/url";
import { assertUrlIsSafe } from "@/scanner/url-safety/url-safety";
import type { HostResolver } from "@/scanner/url-safety/resolver";

function resolverFor(map: Record<string, string>): HostResolver {
  return {
    async lookup(hostname) {
      const address = map[hostname.toLowerCase()];

      if (!address) {
        return [];
      }

      return [{ address, family: address.includes(":") ? 6 : 4 }];
    }
  };
}

describe("URL normalization", () => {
  it("normalizes a bare domain", () => {
    const normalized = normalizeUserUrl("example.ru");

    expect(normalized.canonicalStartUrl).toBe("https://example.ru/");
    expect(normalized.normalizedDomain).toBe("example.ru");
    expect(normalized.allowedHosts).toEqual(["example.ru", "www.example.ru"]);
  });

  it("normalizes an https URL", () => {
    const normalized = normalizeUserUrl("https://example.ru");

    expect(normalized.canonicalStartUrl).toBe("https://example.ru/");
    expect(normalized.normalizedDomain).toBe("example.ru");
  });

  it("keeps subdomain scope bound to the starting host plus www variant", () => {
    const normalized = normalizeUserUrl("shop.example.ru");

    expect(normalized.allowedHosts).toEqual(["shop.example.ru", "www.shop.example.ru"]);
    expect(normalized.allowedHosts).not.toContain("example.ru");
    expect(normalized.allowedHosts).not.toContain("api.example.ru");
  });

  it("rejects malformed URLs", () => {
    expect(() => normalizeUserUrl("http://")).toThrow("Malformed URL");
  });

  it("rejects unsupported schemes", () => {
    expect(() => normalizeUserUrl("ftp://example.ru")).toThrow("Unsupported URL scheme");
  });
});

describe("SSRF protection", () => {
  it.each([
    ["localhost", "http://localhost"],
    ["127.0.0.1", "http://127.0.0.1"],
    ["IPv6 loopback", "http://[::1]"],
    ["private 10/8", "http://10.0.0.1"],
    ["private 172.16/12", "http://172.16.0.1"],
    ["private 192.168/16", "http://192.168.1.1"],
    ["link-local", "http://169.254.10.10"],
    ["metadata endpoint", "http://169.254.169.254"]
  ])("blocks %s", async (_name, url) => {
    await expect(assertUrlIsSafe(url)).rejects.toThrow();
  });

  it("blocks hostnames resolving to private IPs", async () => {
    await expect(
      assertUrlIsSafe("https://public-looking.test", resolverFor({ "public-looking.test": "10.0.0.5" }))
    ).rejects.toThrow("Hostname resolves to a blocked IP address");
  });

  it("blocks a public URL redirecting to a private IP", async () => {
    const transport: FetchTransport = async () => ({
      status: 302,
      headers: { location: "http://127.0.0.1/internal" },
      body: ""
    });

    await expect(
      fetchPage("https://public.test", DEFAULT_CRAWL_CONFIG, {
        resolver: resolverFor({ "public.test": "93.184.216.34" }),
        transport
      })
    ).rejects.toThrow("Blocked IP address");
  });
});
