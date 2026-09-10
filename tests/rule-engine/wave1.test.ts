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

  it("loads 15 versioned runtime rules", () => {
    const rules = loadRuntimeRules();

    expect(rules).toHaveLength(15);
    expect(rules.map((rule) => rule.ruleId)).toEqual([
      "PD-001",
      "PD-002",
      "PD-003",
      "EC-001",
      "EC-002",
      "EC-003",
      "EC-004",
      "EC-005",
      "EC-006",
      "EC-007",
      "EC-008",
      "EC-009",
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

  it("evaluates EC-013 but does not treat foreign provider signals as Wave 1 legal Findings", async () => {
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
    expect(result.evaluations.some((evaluation) => evaluation.ruleId.includes("PD-020"))).toBe(false);
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
