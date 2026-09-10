import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { BETA_ACCESS_COOKIE, betaAccessToken, verifyBetaAccessPassword } from "@/beta-access";
import { middleware } from "../../middleware";

const originalPassword = process.env.BETA_ACCESS_PASSWORD;

afterEach(() => {
  process.env.BETA_ACCESS_PASSWORD = originalPassword;
});

describe("closed beta access gate", () => {
  it("allows access when beta password is not configured", async () => {
    delete process.env.BETA_ACCESS_PASSWORD;
    const response = await middleware(new NextRequest("https://staging.example.test/"));

    expect(response.status).toBe(200);
  });

  it("blocks UI and API without beta access when password is configured", async () => {
    process.env.BETA_ACCESS_PASSWORD = "secret-beta";

    const pageResponse = await middleware(new NextRequest("https://staging.example.test/"));
    const apiResponse = await middleware(new NextRequest("https://staging.example.test/api/scans"));
    const apiBody = await apiResponse.json();

    expect(pageResponse.status).toBe(307);
    expect(pageResponse.headers.get("location")).toBe("https://staging.example.test/beta");
    expect(apiResponse.status).toBe(401);
    expect(apiBody).toEqual({ error: "Требуется beta-доступ" });
    expect(JSON.stringify(apiBody)).not.toContain("secret-beta");
  });

  it("accepts only the configured beta password and validates the cookie token", async () => {
    process.env.BETA_ACCESS_PASSWORD = "secret-beta";
    const token = await betaAccessToken();
    const request = new NextRequest("https://staging.example.test/", {
      headers: { cookie: `${BETA_ACCESS_COOKIE}=${token}` }
    });
    const response = await middleware(request);

    expect(verifyBetaAccessPassword("wrong")).toBe(false);
    expect(verifyBetaAccessPassword("secret-beta")).toBe(true);
    expect(token).not.toBe("secret-beta");
    expect(response.status).toBe(200);
  });
});
