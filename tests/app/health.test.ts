import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health endpoint", () => {
  it("returns a safe status shape without secrets or internals", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const response = await GET();
    const body = await response.json();

    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }

    expect([200, 503]).toContain(response.status);
    expect(Object.keys(body)).toEqual(["status"]);
    expect(JSON.stringify(body)).not.toMatch(/postgres|DATABASE_URL|localhost|node_modules|src/i);
  });
});
