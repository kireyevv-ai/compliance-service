import { readFileSync } from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@/db/client";
import {
  claimNextQueuedScan,
  completeScan,
  createFinding,
  createQueuedScan,
  createSite,
  getEvidenceForScan,
  getEvidenceIdsForFinding,
  getFactsForScan,
  getFindingsForScan,
  upsertUser
} from "@/db/repository";
import { deriveRuntimeFacts } from "@/facts/derived";
import { persistStaticExtraction } from "@/facts/extractors/persistence";
import type { ExtractedFact } from "@/facts/extractors/types";
import { loadRuntimeRules } from "@/legal-rules/runtime";
import { evaluateRulesForScan } from "@/rule-engine/evaluator";
import type { RuleEvaluation } from "@/rule-engine/types";
import type { SiteType } from "@/db/schema";
import type { CrawledPage } from "@/scanner/crawl/types";

function createTestDb(): Queryable {
  const db = newDb();
  db.public.none(
    readFileSync(path.join(process.cwd(), "src", "db", "migrations", "001_initial_schema.sql"), "utf8")
  );
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

function extractedFact(factType: ExtractedFact["factType"], value: Record<string, unknown>, pageUrl?: string): ExtractedFact {
  return {
    pageUrl,
    factType,
    value,
    evidence: [
      {
        evidenceType: "TEXT_FRAGMENT",
        pageUrl: pageUrl ?? "https://example.test/",
        payload: { kind: factType, context: `${factType} evidence` }
      }
    ]
  };
}

function externalServiceMatch(
  pageUrl: string,
  signalType: "NETWORK" | "SCRIPT" | "IFRAME" | "FORM_ACTION",
  providerScope: "FOREIGN_PROVIDER" | "RU_PROVIDER" | "MIXED_REQUIRES_CONTRACT_CHECK",
  host = providerScope === "FOREIGN_PROVIDER" ? "foreign.example" : "local.example"
): ExtractedFact {
  return extractedFact(
    "external_service_matches",
    {
      service_id: `${providerScope.toLowerCase()}-${signalType.toLowerCase()}`,
      service_name: "Synthetic service",
      category: "synthetic",
      matched_host: host,
      signal_type: signalType,
      matched_pattern: host,
      confidence: "HIGH",
      provider_scope: providerScope,
      page_url: pageUrl
    },
    pageUrl
  );
}

function page(url: string, status = 200): CrawledPage {
  return {
    url,
    status,
    contentType: "text/html",
    title: "",
    html: "",
    internalLinks: [],
    externalLinks: [],
    documentLinks: []
  };
}

async function createScan(db: Queryable, siteType: SiteType) {
  const user = await upsertUser(db, {
    id: "00000000-0000-4000-8000-000000000007",
    email: "task007@example.test"
  });
  const site = await createSite(db, {
    userId: user.id,
    url: "https://example.test/",
    normalizedDomain: "example.test"
  });
  const queued = await createQueuedScan(db, {
    siteId: site.id,
    siteType,
    scannerVersion: "task007-test"
  });
  return (await claimNextQueuedScan(db, { useSkipLocked: false })) ?? queued;
}

async function evaluateScenario(input: {
  db: Queryable;
  siteType: SiteType;
  facts: ExtractedFact[];
  pages?: CrawledPage[];
}) {
  const scan = await createScan(input.db, input.siteType);
  const pages = input.pages ?? [page("https://example.test/")];
  const derived = deriveRuntimeFacts({
    facts: input.facts,
    pages,
    startUrl: "https://example.test/",
    siteType: scan.siteType
  });
  await persistStaticExtraction(input.db, scan.id, { facts: [...input.facts, ...derived] });
  const facts = await getFactsForScan(input.db, scan.id);
  const evidence = await getEvidenceForScan(input.db, scan.id);
  return {
    scan,
    evaluations: evaluateRulesForScan({ scan, facts, evidence, rules: loadRuntimeRules() }),
    facts,
    evidence
  };
}

function statusFor(evaluations: ReturnType<typeof evaluateRulesForScan>, ruleId: string) {
  return evaluations.find((evaluation) => evaluation.ruleId === ruleId)?.status;
}

function noEvaluationReasonFor(evaluations: ReturnType<typeof evaluateRulesForScan>, ruleId: string) {
  const evaluation = evaluations.find((item) => item.ruleId === ruleId);
  return evaluation?.status === "NO_EVALUATION" ? evaluation.reason : undefined;
}

describe("Wave 1 runtime rule engine", () => {
  let db: Queryable;

  beforeEach(() => {
    db = createTestDb();
  });

  it("loads 23 versioned runtime rules", () => {
    const rules = loadRuntimeRules();

    expect(rules).toHaveLength(23);
    expect(rules.map((rule) => rule.ruleId)).toEqual([
      "PD-001",
      "PD-002",
      "PD-003",
      "PD-004",
      "PD-006",
      "PD-011",
      "PD-020",
      "PD-021",
      "CK-002",
      "CK-003",
      "EC-001",
      "EC-002",
      "EC-003",
      "EC-004",
      "EC-005",
      "EC-006",
      "EC-007",
      "EC-008",
      "EC-009",
      "EC-011",
      "EC-013",
      "CON-001",
      "CON-002"
    ]);
    expect(rules.every((rule) => rule.version === "1")).toBe(true);
    expect(rules.every((rule) => rule.evaluatorType === "DETERMINISTIC")).toBe(true);
    expect(rules.every((rule) => rule.passSummary && rule.passSummary !== rule.title)).toBe(true);
  });

  it("uses explicit positive PASS summaries instead of failure-condition titles", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/"),
        extractedFact("policy_access_from_collection_page", { found: true }, "https://example.test/form"),
        extractedFact("policy_url_accessible", { accessible: true }, "https://example.test/policy")
      ]
    });

    const passSummaries = result.evaluations
      .filter((evaluation): evaluation is RuleEvaluation => evaluation.status === "PASS")
      .map((evaluation) => evaluation.summary);

    expect(passSummaries).toContain("Политика обработки персональных данных найдена.");
    expect(passSummaries).toContain("Ссылка на политику обработки персональных данных доступна.");
    expect(passSummaries).toContain(
      "На странице сбора персональных данных размещена ссылка на политику обработки персональных данных."
    );
    expect(passSummaries.join(" ")).not.toContain("Проверка пройдена:");
    expect(passSummaries.join(" ")).not.toContain("не найдена");
    expect(passSummaries.join(" ")).not.toContain("недоступна");
    expect(passSummaries.join(" ")).not.toContain("нет доступного пути");
  });

  it("uses distinct PD-001 PASS text when no personal-data forms are found", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: false }),
        extractedFact("personal_data_collection_found", { found: false, scope: "SITE" }),
        extractedFact("privacy_policy_link_found", { found: false, scope: "SITE" })
      ]
    });
    const evaluation = result.evaluations.find(
      (item): item is RuleEvaluation => item.ruleId === "PD-001" && item.status !== "NO_EVALUATION"
    );

    expect(evaluation?.status).toBe("PASS");
    expect(evaluation?.summary).toBe(
      "На проверенных страницах не обнаружены формы, собирающие персональные данные."
    );
  });

  it("uses distinct PD-001 PASS text when personal-data collection and policy are both found", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: false }),
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/form")
      ]
    });
    const evaluation = result.evaluations.find(
      (item): item is RuleEvaluation => item.ruleId === "PD-001" && item.status !== "NO_EVALUATION"
    );

    expect(evaluation?.status).toBe("PASS");
    expect(evaluation?.summary).toBe("Политика обработки персональных данных найдена.");
  });

  it("does not evaluate absence-based PASS or FAIL on limited content", async () => {
    const pdResult = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: true }),
        extractedFact("personal_data_collection_found", { found: false, scope: "SITE" }),
        extractedFact("privacy_policy_link_found", { found: false, scope: "SITE" })
      ]
    });
    const ecommerceResult = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: true }),
        extractedFact("remote_sale_detected", { found: true }),
        extractedFact("offer_link_found", { found: false, scope: "SITE" })
      ]
    });

    expect(statusFor(pdResult.evaluations, "PD-001")).toBe("NO_EVALUATION");
    expect(statusFor(ecommerceResult.evaluations, "EC-001")).toBe("NO_EVALUATION");
  });

  it("allows positive PD and offer PASS results on partial coverage", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: true }),
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/form"),
        extractedFact("policy_access_from_collection_page", { found: true }, "https://example.test/form"),
        extractedFact("remote_sale_detected", { found: true }),
        extractedFact("offer_link_found", { found: true }, "https://example.test/")
      ]
    });

    expect(statusFor(result.evaluations, "PD-001")).toBe("PASS");
    expect(statusFor(result.evaluations, "PD-003")).toBe("PASS");
    expect(statusFor(result.evaluations, "EC-001")).toBe("PASS");
  });

  it("allows seller-contact PASS but not seller-contact FAIL on partial coverage", async () => {
    const positive = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: true }),
        extractedFact("seller_kind", { kind: "LEGAL_ENTITY" }),
        extractedFact("seller_email_found", { found: true, maskedValue: "s***@example.test" }),
        extractedFact("seller_phone_found", { found: false })
      ]
    });
    const absence = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: true }),
        extractedFact("seller_kind", { kind: "LEGAL_ENTITY" }),
        extractedFact("seller_email_found", { found: false }),
        extractedFact("seller_phone_found", { found: false })
      ]
    });

    expect(statusFor(positive.evaluations, "EC-006")).toBe("PASS");
    expect(statusFor(absence.evaluations, "EC-006")).toBe("NO_EVALUATION");
  });

  it("does not create seller-detail absence FAIL on limited coverage", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: true }),
        extractedFact("seller_kind", { kind: "LEGAL_ENTITY" }),
        extractedFact("ogrn_found", { found: false })
      ]
    });

    expect(statusFor(result.evaluations, "EC-004")).toBe("NO_EVALUATION");
  });

  it("treats seller-kind mismatches as not applicable for ECOMMERCE seller rules", async () => {
    const legalEntity = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("seller_kind", { kind: "LEGAL_ENTITY" }),
        extractedFact("seller_email_found", { found: true }),
        extractedFact("seller_phone_found", { found: true })
      ]
    });
    const individualEntrepreneur = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("seller_kind", { kind: "INDIVIDUAL_ENTREPRENEUR" }),
        extractedFact("seller_email_found", { found: true }),
        extractedFact("seller_phone_found", { found: true })
      ]
    });

    expect(statusFor(legalEntity.evaluations, "EC-009")).toBe("NO_EVALUATION");
    expect(noEvaluationReasonFor(legalEntity.evaluations, "EC-009")).toBe(
      "Rule does not apply to seller_kind=LEGAL_ENTITY"
    );
    expect(statusFor(individualEntrepreneur.evaluations, "EC-006")).toBe("NO_EVALUATION");
    expect(noEvaluationReasonFor(individualEntrepreneur.evaluations, "EC-006")).toBe(
      "Rule does not apply to seller_kind=INDIVIDUAL_ENTREPRENEUR"
    );
  });

  it("evaluates PD-001 trigger, clear, and partial-coverage cases", async () => {
    const trigger = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("privacy_policy_link_found", { found: false, scope: "SITE" })
      ]
    });
    expect(statusFor(trigger.evaluations, "PD-001")).toBe("FAIL");

    const clear = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/")
      ]
    });
    expect(statusFor(clear.evaluations, "PD-001")).toBe("PASS");

    const partial = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: false }),
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("privacy_policy_link_found", { found: false, scope: "SITE" })
      ]
    });
    expect(statusFor(partial.evaluations, "PD-001")).toBe("NO_EVALUATION");
  });

  it("evaluates PD-002 and EC-002 from crawler-derived accessibility facts", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      pages: [page("https://example.test/policy", 404), page("https://example.test/offer", 200)],
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/"),
        extractedFact("privacy_policy_url", { url: "https://example.test/policy" }),
        extractedFact("offer_link_found", { found: true }, "https://example.test/"),
        extractedFact("offer_url", { url: "https://example.test/offer" })
      ]
    });

    expect(statusFor(result.evaluations, "PD-002")).toBe("FAIL");
    expect(statusFor(result.evaluations, "EC-002")).toBe("PASS");
  });

  it("separates technical policy accessibility PD-002 from restricted-access PD-004", async () => {
    const publicPolicy = await evaluateScenario({
      db,
      siteType: "B2B",
      pages: [page("https://example.test/policy", 200)],
      facts: [
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/"),
        extractedFact("privacy_policy_url", { url: "https://example.test/policy" })
      ]
    });
    const authRestrictedPolicy = await evaluateScenario({
      db,
      siteType: "B2B",
      pages: [page("https://example.test/policy", 401)],
      facts: [
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/"),
        extractedFact("privacy_policy_url", { url: "https://example.test/policy" })
      ]
    });
    const genericForbiddenPolicy = await evaluateScenario({
      db,
      siteType: "B2B",
      pages: [page("https://example.test/policy", 403)],
      facts: [
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/"),
        extractedFact("privacy_policy_url", { url: "https://example.test/policy" })
      ]
    });
    const antibotForbiddenPolicy = await evaluateScenario({
      db,
      siteType: "B2B",
      pages: [{ ...page("https://example.test/policy", 403), contentLimited: true }],
      facts: [
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/"),
        extractedFact("privacy_policy_url", { url: "https://example.test/policy" }),
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: true }, "https://example.test/")
      ]
    });
    const gonePolicy = await evaluateScenario({
      db,
      siteType: "B2B",
      pages: [page("https://example.test/policy", 410)],
      facts: [
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/"),
        extractedFact("privacy_policy_url", { url: "https://example.test/policy" })
      ]
    });
    const transientFailure = await evaluateScenario({
      db,
      siteType: "B2B",
      pages: [page("https://example.test/policy", 500)],
      facts: [
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/"),
        extractedFact("privacy_policy_url", { url: "https://example.test/policy" })
      ]
    });
    const policyMissing = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("privacy_policy_link_found", { found: false, scope: "SITE" }, "https://example.test/")
      ]
    });

    expect(statusFor(publicPolicy.evaluations, "PD-004")).toBe("PASS");
    expect(statusFor(authRestrictedPolicy.evaluations, "PD-004")).toBe("FAIL");
    expect(statusFor(authRestrictedPolicy.evaluations, "PD-002")).toBe("NO_EVALUATION");
    expect(statusFor(genericForbiddenPolicy.evaluations, "PD-004")).toBe("NO_EVALUATION");
    expect(statusFor(antibotForbiddenPolicy.evaluations, "PD-004")).toBe("NO_EVALUATION");
    expect(statusFor(gonePolicy.evaluations, "PD-002")).toBe("FAIL");
    expect(statusFor(gonePolicy.evaluations, "PD-004")).toBe("NO_EVALUATION");
    expect(statusFor(transientFailure.evaluations, "PD-002")).toBe("NO_EVALUATION");
    expect(statusFor(transientFailure.evaluations, "PD-004")).toBe("NO_EVALUATION");
    expect(statusFor(policyMissing.evaluations, "PD-004")).toBe("NO_EVALUATION");
  });

  it("evaluates PD-006 only from rendered personal-data consent checked state", async () => {
    const checked = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("rendered_consent_control_found", {
          found: true,
          personalDataConsent: true,
          formIndex: 0,
          controlIndex: 1
        }, "https://example.test/form"),
        extractedFact("rendered_consent_checked", {
          checked: true,
          formIndex: 0,
          controlIndex: 1
        }, "https://example.test/form")
      ]
    });
    const unchecked = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("rendered_consent_control_found", {
          found: true,
          personalDataConsent: true,
          formIndex: 0,
          controlIndex: 1
        }, "https://example.test/form"),
        extractedFact("rendered_consent_checked", {
          checked: false,
          formIndex: 0,
          controlIndex: 1
        }, "https://example.test/form")
      ]
    });
    const missingState = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("rendered_consent_control_found", {
          found: true,
          personalDataConsent: true,
          formIndex: 0,
          controlIndex: 1
        }, "https://example.test/form")
      ]
    });
    const unrelatedCheckbox = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("rendered_consent_control_found", {
          found: true,
          personalDataConsent: false,
          formIndex: 0,
          controlIndex: 1
        }, "https://example.test/form"),
        extractedFact("rendered_consent_checked", {
          checked: true,
          formIndex: 0,
          controlIndex: 1
        }, "https://example.test/form")
      ]
    });

    expect(statusFor(checked.evaluations, "PD-006")).toBe("FAIL");
    expect(statusFor(unchecked.evaluations, "PD-006")).toBe("PASS");
    expect(statusFor(missingState.evaluations, "PD-006")).toBe("NO_EVALUATION");
    expect(statusFor(unrelatedCheckbox.evaluations, "PD-006")).toBe("NO_EVALUATION");
  });

  it("evaluates PD-011 only for rendered marketing consent controls", async () => {
    const marketingChecked = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("rendered_marketing_consent_found", {
          found: true,
          formIndex: 0,
          controlIndex: 2
        }, "https://example.test/form"),
        extractedFact("rendered_marketing_consent_checked", {
          checked: true,
          formIndex: 0,
          controlIndex: 2
        }, "https://example.test/form")
      ]
    });
    const marketingUnchecked = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("rendered_marketing_consent_found", {
          found: true,
          formIndex: 0,
          controlIndex: 2
        }, "https://example.test/form"),
        extractedFact("rendered_marketing_consent_checked", {
          checked: false,
          formIndex: 0,
          controlIndex: 2
        }, "https://example.test/form")
      ]
    });
    const pdConsentOnly = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("rendered_consent_control_found", {
          found: true,
          personalDataConsent: true,
          formIndex: 0,
          controlIndex: 1
        }, "https://example.test/form"),
        extractedFact("rendered_consent_checked", {
          checked: true,
          formIndex: 0,
          controlIndex: 1
        }, "https://example.test/form")
      ]
    });
    const noMarketingContext = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("marketing_subscription_detected", { found: false, scope: "SITE" }, "https://example.test/")
      ]
    });

    expect(statusFor(marketingChecked.evaluations, "PD-011")).toBe("FAIL");
    expect(statusFor(marketingUnchecked.evaluations, "PD-011")).toBe("PASS");
    expect(statusFor(pdConsentOnly.evaluations, "PD-011")).toBe("NO_EVALUATION");
    expect(statusFor(noMarketingContext.evaluations, "PD-011")).toBe("NO_EVALUATION");
  });

  it("evaluates CK-002 only for explicit optional cookie or tracking consent controls", async () => {
    const cookieChecked = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("rendered_consent_control_found", { found: true, formIndex: 0, controlIndex: 1 }, "https://example.test/"),
        extractedFact("rendered_consent_text", { text: "Согласен на использование cookie для аналитики", formIndex: 0, controlIndex: 1 }, "https://example.test/"),
        extractedFact("rendered_consent_checked", { checked: true, formIndex: 0, controlIndex: 1 }, "https://example.test/")
      ]
    });
    const cookieUnchecked = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("rendered_consent_control_found", { found: true, formIndex: 0, controlIndex: 1 }, "https://example.test/"),
        extractedFact("rendered_consent_text", { text: "Согласен на cookie и аналитику", formIndex: 0, controlIndex: 1 }, "https://example.test/"),
        extractedFact("rendered_consent_checked", { checked: false, formIndex: 0, controlIndex: 1 }, "https://example.test/")
      ]
    });
    const mandatoryPdOnly = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("rendered_consent_control_found", { found: true, formIndex: 0, controlIndex: 1 }, "https://example.test/"),
        extractedFact("rendered_consent_text", { text: "Согласен на обработку персональных данных", formIndex: 0, controlIndex: 1 }, "https://example.test/"),
        extractedFact("rendered_consent_checked", { checked: true, formIndex: 0, controlIndex: 1 }, "https://example.test/")
      ]
    });
    const missingCheckedState = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("rendered_consent_control_found", { found: true, formIndex: 0, controlIndex: 1 }, "https://example.test/"),
        extractedFact("rendered_consent_text", { text: "Согласен на использование cookie", formIndex: 0, controlIndex: 1 }, "https://example.test/")
      ]
    });

    expect(statusFor(cookieChecked.evaluations, "CK-002")).toBe("FAIL");
    expect(statusFor(cookieUnchecked.evaluations, "CK-002")).toBe("PASS");
    expect(statusFor(mandatoryPdOnly.evaluations, "CK-002")).toBe("NO_EVALUATION");
    expect(statusFor(missingCheckedState.evaluations, "CK-002")).toBe("NO_EVALUATION");
  });

  it("keeps CK-003 as MANUAL_CHECK-only for pre-interaction marketing or analytics tracker signals", async () => {
    const tracker = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("external_service_detected", { detected: true }, "https://example.test/"),
        extractedFact("external_service_matches", {
          service_name: "Yandex Metrica",
          category: "analytics",
          signal_type: "SCRIPT",
          matched_host: "mc.yandex.ru"
        }, "https://example.test/")
      ]
    });
    const technicalServiceOnly = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("external_service_detected", { detected: true }, "https://example.test/"),
        extractedFact("external_service_matches", {
          service_name: "Static CDN",
          category: "technical_asset",
          signal_type: "SCRIPT",
          matched_host: "cdn.example"
        }, "https://example.test/")
      ]
    });

    expect(statusFor(tracker.evaluations, "CK-003")).toBe("MANUAL_CHECK");
    expect(statusFor(technicalServiceOnly.evaluations, "CK-003")).toBe("NO_EVALUATION");
  });

  it("evaluates PD-020 as a same-page foreign-provider risk signal only for personal-data pages", async () => {
    const pdPage = "https://example.test/form";
    const ordinaryPage = "https://example.test/about";
    const triggered = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true, formIndex: 0 }, pdPage),
        extractedFact("external_service_detected", { detected: true }, "https://example.test/"),
        externalServiceMatch(pdPage, "SCRIPT", "FOREIGN_PROVIDER", "foreign.example")
      ]
    });
    const foreignOnlyOnOrdinaryPage = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true, formIndex: 0 }, pdPage),
        extractedFact("external_service_detected", { detected: true }, "https://example.test/"),
        externalServiceMatch(ordinaryPage, "SCRIPT", "FOREIGN_PROVIDER", "foreign.example")
      ]
    });
    const pdPageWithoutForeignService = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: false }),
        extractedFact("personal_data_collection_found", { found: true, formIndex: 0 }, pdPage),
        extractedFact("external_service_detected", { detected: false, service_count: 0, services: [] }, "https://example.test/")
      ]
    });
    const partialCoverage = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: true }),
        extractedFact("personal_data_collection_found", { found: true, formIndex: 0 }, pdPage),
        extractedFact("external_service_detected", { detected: false, service_count: 0, services: [] }, "https://example.test/")
      ]
    });

    expect(statusFor(triggered.evaluations, "PD-020")).toBe("WARNING");
    expect(statusFor(foreignOnlyOnOrdinaryPage.evaluations, "PD-020")).toBe("NO_EVALUATION");
    expect(statusFor(pdPageWithoutForeignService.evaluations, "PD-020")).toBe("PASS");
    expect(statusFor(partialCoverage.evaluations, "PD-020")).toBe("NO_EVALUATION");
  });

  it("evaluates PD-021 only from a classified form action target of the personal-data form", async () => {
    const pdPage = "https://example.test/form";
    const localForm = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true, formIndex: 0 }, pdPage),
        extractedFact("form_action_target", {
          formIndex: 0,
          actionUrl: "https://example.test/submit",
          host: "example.test",
          externalToPageHost: false
        }, pdPage)
      ]
    });
    const foreignTarget = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true, formIndex: 0 }, pdPage),
        extractedFact("form_action_target", {
          formIndex: 0,
          actionUrl: "https://foreign.example/submit",
          host: "foreign.example",
          externalToPageHost: true
        }, pdPage),
        externalServiceMatch(pdPage, "FORM_ACTION", "FOREIGN_PROVIDER", "foreign.example")
      ]
    });
    const foreignScriptLocalTarget = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true, formIndex: 0 }, pdPage),
        extractedFact("form_action_target", {
          formIndex: 0,
          actionUrl: "https://example.test/submit",
          host: "example.test",
          externalToPageHost: false
        }, pdPage),
        externalServiceMatch(pdPage, "SCRIPT", "FOREIGN_PROVIDER", "foreign.example")
      ]
    });
    const unknownTarget = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("personal_data_collection_found", { found: true, formIndex: 0 }, pdPage)
      ]
    });

    expect(statusFor(foreignTarget.evaluations, "PD-021")).toBe("WARNING");
    expect(statusFor(localForm.evaluations, "PD-021")).toBe("PASS");
    expect(statusFor(foreignScriptLocalTarget.evaluations, "PD-021")).toBe("PASS");
    expect(statusFor(unknownTarget.evaluations, "PD-021")).toBe("NO_EVALUATION");
  });

  it("does not create ECOMMERCE Findings for B2B site type", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("remote_sale_detected", { found: true }),
        extractedFact("offer_link_found", { found: false, scope: "SITE" })
      ]
    });

    expect(statusFor(result.evaluations, "EC-001")).toBe("NO_EVALUATION");
  });

  it("evaluates EC-011 only for paid add-ons in ecommerce checkout context", async () => {
    const preselectedPaidAddon = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("paid_addon_control_found", {
          found: true,
          formIndex: 0,
          controlIndex: 3
        }, "https://example.test/checkout"),
        extractedFact("paid_addon_preselected", {
          preselected: true,
          formIndex: 0,
          controlIndex: 3
        }, "https://example.test/checkout")
      ]
    });
    const unselectedPaidAddon = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("paid_addon_control_found", {
          found: true,
          formIndex: 0,
          controlIndex: 3
        }, "https://example.test/checkout"),
        extractedFact("paid_addon_preselected", {
          preselected: false,
          formIndex: 0,
          controlIndex: 3
        }, "https://example.test/checkout")
      ]
    });
    const missingPreselectedState = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("paid_addon_control_found", {
          found: true,
          formIndex: 0,
          controlIndex: 3
        }, "https://example.test/checkout")
      ]
    });
    const freePreselectedOption = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("rendered_consent_control_found", {
          found: true,
          formIndex: 0,
          controlIndex: 4
        }, "https://example.test/checkout"),
        extractedFact("rendered_consent_checked", {
          checked: true,
          formIndex: 0,
          controlIndex: 4
        }, "https://example.test/checkout")
      ]
    });
    const checkedControlWithoutAddonSemantics = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("rendered_marketing_consent_found", {
          found: true,
          formIndex: 0,
          controlIndex: 5
        }, "https://example.test/checkout"),
        extractedFact("rendered_marketing_consent_checked", {
          checked: true,
          formIndex: 0,
          controlIndex: 5
        }, "https://example.test/checkout")
      ]
    });
    const nonEcommerce = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("paid_addon_control_found", {
          found: true,
          formIndex: 0,
          controlIndex: 3
        }, "https://example.test/checkout"),
        extractedFact("paid_addon_preselected", {
          preselected: true,
          formIndex: 0,
          controlIndex: 3
        }, "https://example.test/checkout")
      ]
    });

    expect(statusFor(preselectedPaidAddon.evaluations, "EC-011")).toBe("FAIL");
    expect(statusFor(unselectedPaidAddon.evaluations, "EC-011")).toBe("PASS");
    expect(statusFor(missingPreselectedState.evaluations, "EC-011")).toBe("NO_EVALUATION");
    expect(statusFor(freePreselectedOption.evaluations, "EC-011")).toBe("NO_EVALUATION");
    expect(statusFor(checkedControlWithoutAddonSemantics.evaluations, "EC-011")).toBe("NO_EVALUATION");
    expect(statusFor(nonEcommerce.evaluations, "EC-011")).toBe("NO_EVALUATION");
  });

  it("does not trigger absence-based EC-001 when crawl coverage is capped or blocked", async () => {
    const capped = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, maxPagesReached: true }),
        extractedFact("remote_sale_detected", { found: true }),
        extractedFact("offer_link_found", { found: false, scope: "SITE" })
      ]
    });
    const blocked = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, successfulHtmlPages: 0, httpErrorPages: 1 }),
        extractedFact("remote_sale_detected", { found: true }),
        extractedFact("offer_link_found", { found: false, scope: "SITE" })
      ]
    });

    expect(statusFor(capped.evaluations, "EC-001")).toBe("NO_EVALUATION");
    expect(statusFor(blocked.evaluations, "EC-001")).toBe("NO_EVALUATION");
  });

  it("evaluates legal-entity seller rules and keeps CON-001 as WARNING", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "B2C_SERVICE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("seller_legal_name_candidate", { value: "ООО Ромашка", confidence: "HIGH" }),
        extractedFact("ogrn_candidate", { value: "1027700132195", confidence: "HIGH" }),
        extractedFact("seller_address_found", { found: false }),
        extractedFact("working_hours_candidate", { value: "10:00-19:00" })
      ]
    });

    expect(statusFor(result.evaluations, "CON-001")).toBe("WARNING");
    expect(statusFor(result.evaluations, "CON-002")).toBe("NO_EVALUATION");
  });

  it("evaluates IP seller rules and keeps CON-002 as WARNING when registration info is missing", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "B2C_SERVICE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("seller_fio_candidate", { value: "ИП Иванов Иван Иванович", confidence: "HIGH" }),
        extractedFact("seller_email_found", { found: true, maskedValue: "i***@example.ru" }),
        extractedFact("ip_registration_info_found", { found: false })
      ]
    });

    expect(statusFor(result.evaluations, "CON-002")).toBe("WARNING");
    expect(statusFor(result.evaluations, "CON-001")).toBe("NO_EVALUATION");
  });

  it("evaluates EC-013 but does not treat site-level foreign provider signals as PD-020 or PD-021", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("price_occurrence", { amount: 25, currencyMarker: "USD", isRuble: false }, "https://example.test/product"),
        extractedFact("ruble_price_found", { found: false, scope: "SITE" }),
        extractedFact("foreign_provider_signal_found", { found: true, service_ids: ["google-tag"] })
      ]
    });

    expect(statusFor(result.evaluations, "EC-013")).toBe("FAIL");
    expect(statusFor(result.evaluations, "PD-020")).toBe("NO_EVALUATION");
    expect(statusFor(result.evaluations, "PD-021")).toBe("NO_EVALUATION");
  });

  it("does not return FAIL when triggered evidence is missing", async () => {
    const scan = await createScan(db, "B2B");
    const facts = [
      {
        id: "00000000-0000-4000-8000-000000000101",
        scanId: scan.id,
        factType: "scan_coverage",
        value: { crawlCompleted: true },
        createdAt: new Date()
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        scanId: scan.id,
        pageUrl: "https://example.test/form",
        factType: "personal_data_collection_found",
        value: { found: true },
        createdAt: new Date()
      },
      {
        id: "00000000-0000-4000-8000-000000000103",
        scanId: scan.id,
        factType: "privacy_policy_link_found",
        value: { found: false },
        createdAt: new Date()
      }
    ];

    const evaluations = evaluateRulesForScan({ scan, facts, evidence: [], rules: loadRuntimeRules() });

    expect(statusFor(evaluations, "PD-001")).toBe("NO_EVALUATION");
  });

  it("does not run non-deterministic rules through the deterministic evaluator", async () => {
    const scan = await createScan(db, "B2B");
    const deterministicRule = loadRuntimeRules().find((rule) => rule.ruleId === "PD-001")!;
    const facts = [
      {
        id: "00000000-0000-4000-8000-000000000111",
        scanId: scan.id,
        factType: "scan_coverage",
        value: { crawlCompleted: true },
        createdAt: new Date()
      },
      {
        id: "00000000-0000-4000-8000-000000000112",
        scanId: scan.id,
        pageUrl: "https://example.test/form",
        factType: "personal_data_collection_found",
        value: { found: true },
        createdAt: new Date()
      },
      {
        id: "00000000-0000-4000-8000-000000000113",
        scanId: scan.id,
        factType: "privacy_policy_link_found",
        value: { found: false },
        createdAt: new Date()
      }
    ];

    for (const evaluatorType of ["LLM_SEMANTIC", "OWNER_MANUAL"] as const) {
      const [evaluation] = evaluateRulesForScan({
        scan,
        facts,
        evidence: [],
        rules: [{ ...deterministicRule, evaluatorType }]
      });

      expect(evaluation).toMatchObject({
        ruleId: "PD-001",
        status: "NO_EVALUATION",
        reason: `Unsupported evaluator_type=${evaluatorType}`
      });
    }
  });

  it("links EC-003 PASS to the source legal-name candidate evidence", async () => {
    const result = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true, contentLimited: false }),
        extractedFact("seller_legal_name_candidate", { value: "ООО «ГРАМОТА»", confidence: "HIGH" }, "https://example.test/")
      ]
    });
    const evaluation = result.evaluations.find(
      (item): item is RuleEvaluation => item.ruleId === "EC-003" && item.status !== "NO_EVALUATION"
    )!;
    const candidateEvidence = result.evidence.find(
      (item) => item.payload?.kind === "seller_legal_name_candidate"
    )!;

    expect(evaluation.status).toBe("PASS");
    expect(evaluation.evidenceIds).toContain(candidateEvidence.id);
  });

  it("links PD-003 PASS to policy-access evidence and same-page policy link evidence", async () => {
    const formPage = "https://example.test/checkout";
    const result = await evaluateScenario({
      db,
      siteType: "ECOMMERCE",
      facts: [
        extractedFact("personal_data_collection_found", { found: true }, formPage),
        extractedFact("policy_access_from_collection_page", { found: true }, formPage),
        extractedFact("privacy_policy_link_found", { found: true }, formPage)
      ]
    });
    const evaluation = result.evaluations.find(
      (item): item is RuleEvaluation => item.ruleId === "PD-003" && item.status !== "NO_EVALUATION"
    )!;
    const accessEvidence = result.evidence.find(
      (item) => item.payload?.kind === "policy_access_from_collection_page"
    )!;
    const policyLinkEvidence = result.evidence.find(
      (item) => item.payload?.kind === "privacy_policy_link_found"
    )!;

    expect(evaluation.status).toBe("PASS");
    expect(evaluation.evidenceIds).toContain(accessEvidence.id);
    expect(evaluation.evidenceIds).toContain(policyLinkEvidence.id);
  });

  it("persists Findings with rule version and finding_evidence links without rewriting historical scans", async () => {
    const first = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("privacy_policy_link_found", { found: false, scope: "SITE" })
      ]
    });
    const firstEvaluation = first.evaluations.find(
      (evaluation): evaluation is RuleEvaluation => evaluation.ruleId === "PD-001" && evaluation.status !== "NO_EVALUATION"
    )!;
    const firstFinding = await createFinding(db, { ...firstEvaluation, scanId: first.scan.id });
    await completeScan(db, first.scan.id);

    const second = await evaluateScenario({
      db,
      siteType: "B2B",
      facts: [
        extractedFact("scan_coverage", { crawlCompleted: true }),
        extractedFact("personal_data_collection_found", { found: true }, "https://example.test/form"),
        extractedFact("privacy_policy_link_found", { found: true }, "https://example.test/")
      ]
    });
    const secondEvaluation = second.evaluations.find(
      (evaluation): evaluation is RuleEvaluation => evaluation.ruleId === "PD-001" && evaluation.status !== "NO_EVALUATION"
    )!;
    await createFinding(db, { ...secondEvaluation, scanId: second.scan.id });

    const firstFindings = await getFindingsForScan(db, first.scan.id);
    const secondFindings = await getFindingsForScan(db, second.scan.id);
    const linkedEvidenceIds = await getEvidenceIdsForFinding(db, firstFinding.id);

    expect(firstFindings).toHaveLength(1);
    expect(firstFindings[0]).toMatchObject({ ruleId: "PD-001", ruleVersion: "1", status: "FAIL" });
    expect(secondFindings).toHaveLength(1);
    expect(secondFindings[0]).toMatchObject({ ruleId: "PD-001", ruleVersion: "1", status: "PASS" });
    expect(linkedEvidenceIds.length).toBeGreaterThan(0);
  });
});
