export const BETA_ACCESS_COOKIE = "beta_access";

function betaPassword(): string | undefined {
  const value = process.env.BETA_ACCESS_PASSWORD?.trim();
  return value || undefined;
}

export function isBetaAccessEnabled(): boolean {
  return Boolean(betaPassword());
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function betaAccessToken(): Promise<string | undefined> {
  const password = betaPassword();

  if (!password) {
    return undefined;
  }

  return sha256Hex(`rf-compliance-beta:${password}`);
}

export function verifyBetaAccessPassword(candidate: string): boolean {
  const password = betaPassword();

  if (!password) {
    return true;
  }

  return candidate === password;
}

export async function verifyBetaAccessToken(candidate?: string | null): Promise<boolean> {
  const expected = await betaAccessToken();

  if (!expected) {
    return true;
  }

  if (!candidate) {
    return false;
  }

  return candidate === expected;
}
