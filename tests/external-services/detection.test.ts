import { readFileSync } from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import type { Queryable } from "@/db/client";
import { createQueuedScan, createSite, upsertUser } from "@/db/repository";
import { enabledExternalServices, loadExternalServicesCatalog } from "@/external-services/catalog";
import { detectExternalServices } from "@/external-services/detection";
import { persistStaticExtraction } from "@/facts/extractors/persistence";
import type { ExtractedFact } from "@/facts/extractors/types";

const pageUrl = "https://example.test/";

function network(hostname: string, sanitizedUrl = `https://${hostname}/collect`): ExtractedFact {
  return {
    pageUrl,
    factType: "network_request_hosts",
    value: {
      requests: [{ hostname, resourceType: "script", relation: "OTHER_HOST", sanitizedUrl }]
    },
    evidence: []
  };
}

function script(url: string): ExtractedFact {
  return {
    pageUrl,
    factType: "script_sources_rendered",
    value: { sources: [{ url: sanitizeUrl(url), hostname: new URL(url).hostname }] },
    evidence: []
  };
}

function iframe(url: string): ExtractedFact {
  return {
    pageUrl,
    factType: "iframe_sources_rendered",
    value: { sources: [{ url: sanitizeUrl(url), hostname: new URL(url).hostname }] },
    evidence: []
  };
}

function formAction(url: string): ExtractedFact {
  return {
    pageUrl,
    factType: "rendered_form_action_target",
    value: { actionUrl: sanitizeUrl(url), host: new URL(url).hostname, externalToPageHost: true },
    evidence: []
  };
}

function values(result: { facts: ExtractedFact[] }, factType: string) {
  return result.facts.filter((fact) => fact.factType === factType).map((fact) => fact.value);
}

function matchIds(result: { facts: ExtractedFact[] }) {
  return values(result, "external_service_matches").map((value) => value.service_id);
}

function createTestDb(): Queryable {
  const db = newDb();
  db.public.none(
    readFileSync(path.join(process.cwd(), "src", "db", "migrations", "001_initial_schema.sql"), "utf8")
  );
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

describe("external service detection", () => {
  it("loads only enabled catalog entries for runtime detection", () => {
    const catalog = loadExternalServicesCatalog();
    const enabled = enabledExternalServices(catalog);

    expect(catalog).toHaveLength(38);
    expect(enabled).toHaveLength(15);
    expect(enabled.every((service) => service.enabled && service.confidence !== "CANDIDATE")).toBe(true);
  });

  it("detects enabled services from network, script, iframe, and form action observations", () => {
    const result = detectExternalServices({
      startUrl: pageUrl,
      facts: [
        network("mc.yandex.ru"),
        script("https://www.googletagmanager.com/gtag/js?id=G-SECRET"),
        script("https://www.google.com/recaptcha/api.js?render=secret"),
        script("https://api-maps.yandex.ru/2.1/?apikey=secret"),
        network("suggestions.dadata.ru", "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address?query=secret"),
        script("https://code.jivo.ru/widget/abc"),
        script("https://mod.calltouch.ru/init.js?id=secret"),
        script("https://cloud.roistat.com/tracking.js"),
        iframe("https://smartcaptcha.yandexcloud.net/widget"),
        formAction("https://bitrix24.ru/pub/form.php?id=secret")
      ]
    });

    expect(matchIds(result)).toEqual(
      expect.arrayContaining([
        "yandex-metrica",
        "google-tag",
        "google-recaptcha",
        "yandex-maps",
        "dadata",
        "jivo",
        "calltouch",
        "roistat",
        "yandex-smartcaptcha",
        "bitrix24-widget"
      ])
    );
    expect(values(result, "external_service_detected")[0]).toMatchObject({
      detected: true,
      service_count: 10,
      service_ids: expect.arrayContaining(["google-tag", "yandex-metrica"])
    });
  });

  it("protects broad domains and disabled candidate entries from false positives", () => {
    const result = detectExternalServices({
      startUrl: pageUrl,
      facts: [
        script("https://www.google.com/search?q=recaptcha"),
        script("https://vk.com/js/api/openapi.js"),
        iframe("https://www.youtube.com/embed/video-id"),
        network("unknown-third-party.example")
      ]
    });

    expect(matchIds(result)).not.toContain("google-recaptcha");
    expect(matchIds(result)).not.toContain("vk-pixel");
    expect(matchIds(result)).not.toContain("vk-widgets");
    expect(matchIds(result)).not.toContain("youtube");
    expect(values(result, "external_service_hosts_unmatched")[0]).toMatchObject({
      observations: expect.arrayContaining([
        expect.objectContaining({ host: "unknown-third-party.example", signal_type: "NETWORK" }),
        expect.objectContaining({ host: "vk.com", signal_type: "SCRIPT" }),
        expect.objectContaining({ host: "www.youtube.com", signal_type: "IFRAME" })
      ])
    });
  });

  it("creates foreign-provider technical signal without legal violation facts", () => {
    const result = detectExternalServices({
      startUrl: pageUrl,
      facts: [script("https://www.googletagmanager.com/gtag/js?id=G-SECRET")]
    });
    const serialized = JSON.stringify(result);

    expect(values(result, "foreign_provider_signal_found")[0]).toMatchObject({
      found: true,
      service_ids: ["google-tag"]
    });
    expect(serialized).not.toContain("cross_border_violation");
    expect(serialized).not.toContain("localization_violation");
    expect(serialized).not.toContain("illegal_foreign_service");
  });

  it("does not create foreign-provider signal for RU or mixed provider scopes", () => {
    const ruResult = detectExternalServices({ startUrl: pageUrl, facts: [network("mc.yandex.ru")] });
    const mixedResult = detectExternalServices({ startUrl: pageUrl, facts: [script("https://cloud.roistat.com/tracking.js")] });

    expect(values(ruResult, "foreign_provider_signal_found")).toHaveLength(0);
    expect(values(mixedResult, "foreign_provider_signal_found")).toHaveLength(0);
    expect(values(mixedResult, "external_service_detected")[0]).toMatchObject({
      services: [expect.objectContaining({ provider_scope: "MIXED_REQUIRES_CONTRACT_CHECK" })]
    });
  });

  it("deduplicates repeated page-level matches and site-level summary while preserving signal types", () => {
    const result = detectExternalServices({
      startUrl: pageUrl,
      facts: [
        ...Array.from({ length: 20 }, () => network("mc.yandex.ru")),
        script("https://mc.yandex.ru/metrika/tag.js"),
        network("mc.yandex.com")
      ]
    });
    const matches = values(result, "external_service_matches");
    const summary = values(result, "external_service_detected")[0];

    expect(matches.filter((match) => match.service_id === "yandex-metrica" && match.signal_type === "NETWORK" && match.matched_host === "mc.yandex.ru")).toHaveLength(1);
    expect(summary).toMatchObject({
      service_count: 1,
      services: [
        expect.objectContaining({
          service_id: "yandex-metrica",
          confidence: "HIGH",
          signal_types: expect.arrayContaining(["NETWORK", "SCRIPT"]),
          matched_hosts: expect.arrayContaining(["mc.yandex.ru", "mc.yandex.com"])
        })
      ]
    });
  });

  it("limits unmatched external observations", () => {
    const result = detectExternalServices({
      startUrl: pageUrl,
      config: { maxUnmatchedObservationsPerScan: 3 },
      facts: Array.from({ length: 10 }, (_value, index) => network(`unknown-${index}.example`))
    });

    expect(values(result, "external_service_hosts_unmatched")[0]).toMatchObject({
      observations: expect.arrayContaining([
        expect.objectContaining({ host: "unknown-0.example" }),
        expect.objectContaining({ host: "unknown-1.example" }),
        expect.objectContaining({ host: "unknown-2.example" })
      ]),
      limit: 3
    });
    expect(values(result, "external_service_hosts_unmatched")[0].observations).toHaveLength(3);
  });

  it("persists sanitized service evidence without sensitive query values", async () => {
    const db = createTestDb();
    const user = await upsertUser(db, {
      id: "00000000-0000-4000-8000-000000000006",
      email: "task006@example.test"
    });
    const site = await createSite(db, {
      userId: user.id,
      url: pageUrl,
      normalizedDomain: "example.test"
    });
    const scan = await createQueuedScan(db, {
      siteId: site.id,
      siteType: "B2B",
      scannerVersion: "task006-test"
    });
    const detection = detectExternalServices({
      startUrl: pageUrl,
      facts: [script("https://www.google.com/recaptcha/api.js?email=user@example.com&token=secret")]
    });

    await persistStaticExtraction(db, scan.id, detection);

    const facts = await db.query<{ value_json: unknown }>("select value_json from facts where scan_id = $1", [scan.id]);
    const evidence = await db.query<{ payload_json: unknown }>("select payload_json from evidence where scan_id = $1", [
      scan.id
    ]);
    const serialized = JSON.stringify({ facts: facts.rows, evidence: evidence.rows });

    expect(serialized).toContain("/recaptcha/api.js");
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("secret");
  });
});

function sanitizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.search = url.search ? "?[redacted]" : "";
  return url.toString();
}
