import net from "node:net";
import { isBlockedIpAddress } from "./ip";
import { dnsHostResolver, type HostResolver, type ResolvedAddress } from "./resolver";

const LOCALHOST_NAMES = new Set(["localhost", "localhost.localdomain"]);

export interface SafeUrlResolution {
  url: URL;
  addresses: ResolvedAddress[];
}

export async function assertUrlIsSafe(
  input: string | URL,
  resolver: HostResolver = dnsHostResolver
): Promise<SafeUrlResolution> {
  const url = typeof input === "string" ? new URL(input) : input;

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported URL scheme");
  }

  const hostname = url.hostname.toLowerCase();

  if (LOCALHOST_NAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("Blocked localhost hostname");
  }

  if (net.isIP(hostname) && isBlockedIpAddress(hostname)) {
    throw new Error("Blocked IP address");
  }

  const addresses = await resolver.lookup(hostname);

  if (addresses.length === 0) {
    throw new Error("Hostname did not resolve");
  }

  for (const address of addresses) {
    if (isBlockedIpAddress(address.address)) {
      throw new Error("Hostname resolves to a blocked IP address");
    }
  }

  return { url, addresses };
}

export function sanitizeScanFailureReason(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Scan failed";
  }

  if (
    error.message.includes("Blocked") ||
    error.message.includes("Unsupported") ||
    error.message.includes("Malformed") ||
    error.message.includes("timeout") ||
    error.message.includes("Too many redirects") ||
    error.message.includes("Response body too large")
  ) {
    return error.message.slice(0, 160);
  }

  return "Scan failed";
}
