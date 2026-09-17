import { readFileSync } from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import type { Queryable } from "@/db/client";
import {
  createEvidence,
  createFact,
  createQueuedScan,
  createSite,
  getFindingsForScan,
  getEvidenceByIds,
  getEvidenceIdsForFinding,
  getOwnerAnswersForScan,
  upsertOwnerAnswer,
  upsertUser
} from "@/db/repository";
import type { Scan, SiteType } from "@/db/schema";
import { persistOwnerFindingsForScan, persistProductionFindings } from "@/findings/integration";
import { buildFindingViewModels } from "@/app/results/presentation";
import { FakeSemanticModelProvider } from "@/semantic-evaluator/fake-provider";
import type { SemanticModelRequest } from "@/semantic-evaluator/types";

const MIGRATIONS = [
  "001_initial_schema.sql",
  "002_owner_answers.sql",
  "003_owner_answer_context_key.sql",
  "004_findings_unique_rule_result.sql"
];

function createTestDb(): Queryable {
  const db = newDb();
  for (const file of MIGRATIONS) {
    db.public.none(readFileSync(path.join(process.cwd(), "src", "db", "migrations", file), "utf8"));
  }
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

async function createScan(db: Queryable, siteType: SiteType = "B2B"): Promise<Scan> {
  const user = await upsertUser(db, { email: `final-integration-${crypto.randomUUID()}@example.test` });
  const site = await createSite(db, {
    userId: user.id,
    url: "https://example.test/",
    normalizedDomain: "example.test"
  });
  return createQueuedScan(db, { siteId: site.id, siteType, scannerVersion: "final-integration-test" });
}

async function factWithEvidence(
  db: Queryable,
  scanId: string,
  factType: string,
  value: Record<string, unknown>,
  text = "Фрагмент страницы",
  sourceUrl = "https://example.test/"
) {
  const fact = await createFact(db, {
    scanId,
    pageUrl: sourceUrl,
    factType,
    value
  });
  const evidence = await createEvidence(db, {
    scanId,
    factId: fact.id,
    evidenceType: "TEXT_FRAGMENT",
    pageUrl: "https://example.test/",
    payload: {
      text,
      context: text,
      sourceUrl,
      documentType: "HTML",
      fetchStatus: 200,
      fetchContentType: "text/html",
      contentLimited: false,
      interstitialDetected: false,
      extractionSucceeded: true,
      extractionRoot: "main",
      extractionRootFallback: false,
      truncated: false,
      originalTextLength: text.length,
      maxChars: 50_000
    }
  });
  return { fact, evidence };
}

function semanticProvider(observation: "PRESENT" | "ABSENT" | "AMBIGUOUS") {
  return new FakeSemanticModelProvider((request: SemanticModelRequest) => ({
    observation,
    confidence: observation === "AMBIGUOUS" ? 0.45 : 0.88,
    reason_code: `${observation}_TEST`,
    reason: "Synthetic semantic result.",
    evidence_refs: request.evidence.map((item) => item.ref)
  }));
}

function ruleSpecificSemanticProvider() {
  const markers: Record<string, string> = {
    "PD-005": "Отдельность согласия",
    "PD-008": "ТЕКСТ_СОГЛАСИЯ",
    "PD-009": "Объём согласия",
    "PD-010": "Рекламное согласие",
    "PD-013": "ЦЕЛИ_ОБРАБОТКИ",
    "PD-014": "КАТЕГОРИИ_ДАННЫХ",
    "PD-015": "СРОКИ_ХРАНЕНИЯ",
    "PD-016": "ПОРЯДОК_ОБРАЩЕНИЙ",
    "PD-017": "Категории формы",
    "PD-018": "Внешний сервис",
    "PD-019": "Не передаём третьим лицам",
    "PD-024": "Специальные данные",
    "EC-010": "Порядок претензий",
    "EC-012": "Платная услуга",
    "REC-003": "Правила рекомендаций",
    "LANG-001": "Русский язык"
  };
  return new FakeSemanticModelProvider((request: SemanticModelRequest) => {
    const marker = markers[request.ruleId];
    const refs = request.evidence
      .filter((item) => !marker || item.excerpt.includes(marker))
      .map((item) => item.ref);

    const observation = request.ruleId === "PD-024" ? "PRESENT" : "ABSENT";
    return {
      observation,
      confidence: 0.88,
      reason_code: `${observation}_TEST`,
      reason: "Synthetic semantic result.",
      evidence_refs: refs
    };
  });
}

describe("final production finding integration", () => {
  it("persists deterministic-only scan results", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await factWithEvidence(db, scan.id, "scan_coverage", {
      crawlCompleted: true,
      contentLimited: false,
      successfulHtmlPages: 1,
      httpErrorPages: 0
    });
    await factWithEvidence(db, scan.id, "personal_data_collection_found", { found: false });
    await factWithEvidence(db, scan.id, "privacy_policy_link_found", { found: false });

    await persistProductionFindings(db, {
      scan,
      facts: await importFacts(db, scan.id),
      evidence: await importEvidence(db, scan.id)
    });

    const findings = await getFindingsForScan(db, scan.id);
    expect(findings.some((finding) => finding.ruleId === "PD-001" && finding.status === "PASS")).toBe(true);
    expect(findings.some((finding) => finding.ruleId === "PD-008")).toBe(false);
  });

  it("persists deterministic plus validated semantic pilot results", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await factWithEvidence(db, scan.id, "scan_coverage", {
      crawlCompleted: true,
      contentLimited: false,
      successfulHtmlPages: 1,
      httpErrorPages: 0
    });
    await factWithEvidence(db, scan.id, "personal_data_collection_found", { found: false });
    await factWithEvidence(db, scan.id, "privacy_policy_link_found", { found: false });
    await factWithEvidence(db, scan.id, "privacy_policy_text", {
      text: "Политика указывает цели обработки персональных данных.",
      documentType: "HTML",
      fetchStatus: 200,
      fetchContentType: "text/html",
      contentLimited: false,
      interstitialDetected: false,
      extractionSucceeded: true,
      extractionRoot: "main",
      extractionRootFallback: false,
      truncated: false,
      originalTextLength: 52,
      maxChars: 50_000
    }, "Политика указывает цели обработки персональных данных.");

    await persistProductionFindings(db, {
      scan,
      facts: await importFacts(db, scan.id),
      evidence: await importEvidence(db, scan.id),
      semanticProvider: semanticProvider("PRESENT")
    });

    const findings = await getFindingsForScan(db, scan.id);
    expect(findings.some((finding) => finding.ruleId === "PD-001" && finding.status === "PASS")).toBe(true);
    expect(findings.some((finding) => finding.ruleId === "PD-013" && finding.status === "PASS")).toBe(true);
    expect(findings.find((finding) => finding.ruleId === "PD-013")?.remediation).toBe("Дополнительные действия не требуются.");
  });

  it("turns owner answer into PASS", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await factWithEvidence(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "lead-form"
    });
    await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
      contextKey: "lead-form",
      answer: { type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" }
    });

    await persistOwnerFindingsForScan(db, scan);

    const findings = await getFindingsForScan(db, scan.id);
    expect(findings.some((finding) => finding.ruleId === "PD-007" && finding.status === "PASS")).toBe(true);
  });

  it("turns owner answer into FAIL only where rule policy permits it", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await factWithEvidence(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "lead-form"
    });
    await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
      contextKey: "lead-form",
      answer: { type: "SINGLE_SELECT", optionId: "NO_BASIS" }
    });

    await persistOwnerFindingsForScan(db, scan);

    const findings = await getFindingsForScan(db, scan.id);
    expect(findings.find((finding) => finding.ruleId === "PD-007")).toMatchObject({
      status: "FAIL",
      summary: "Для данных из найденных форм не указано законное основание обработки."
    });
  });

  it("keeps owner and site contradiction as MANUAL_CHECK", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await factWithEvidence(db, scan.id, "marketing_subscription_detected", { found: true }, "Подписаться на акции");
    await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_MARKETING_CONSENT_PROOF",
      answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
    });

    await persistOwnerFindingsForScan(db, scan);

    const findings = await getFindingsForScan(db, scan.id);
    const conflict = findings.find((finding) => finding.ruleId === "PD-012");
    expect(conflict).toMatchObject({ status: "MANUAL_CHECK" });
    expect(conflict?.explanation).toContain("Ваш ответ не совпадает");
    expect(JSON.stringify(conflict)).not.toContain("OWNER_ANSWER_CONFLICTS_WITH_SITE_EVIDENCE");
  });

  it("renders deterministic, semantic, and owner findings as one results model", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await factWithEvidence(db, scan.id, "scan_coverage", {
      crawlCompleted: true,
      contentLimited: false,
      successfulHtmlPages: 1,
      httpErrorPages: 0
    });
    await factWithEvidence(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "lead-form"
    });
    await factWithEvidence(db, scan.id, "privacy_policy_link_found", { found: true });
    await factWithEvidence(db, scan.id, "privacy_policy_text", {
      text: "Политика без нужного раздела.",
      documentType: "HTML",
      fetchStatus: 200,
      fetchContentType: "text/html",
      contentLimited: false,
      interstitialDetected: false,
      extractionSucceeded: true,
      extractionRoot: "main",
      extractionRootFallback: false,
      truncated: false,
      originalTextLength: 28,
      maxChars: 50_000
    }, "Политика без нужного раздела.");
    await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
      contextKey: "lead-form",
      answer: { type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" }
    });

    await persistProductionFindings(db, {
      scan,
      facts: await importFacts(db, scan.id),
      evidence: await importEvidence(db, scan.id),
      ownerAnswers: await getOwnerAnswersForScan(db, scan.id),
      semanticProvider: semanticProvider("ABSENT")
    });

    const findings = await getFindingsForScan(db, scan.id);
    const views = buildFindingViewModels(findings, Object.fromEntries(findings.map((finding) => [finding.id, []])));

    expect(findings.some((finding) => finding.ruleId === "PD-001")).toBe(true);
    expect(findings.some((finding) => finding.ruleId === "PD-013")).toBe(true);
    expect(findings.some((finding) => finding.ruleId === "PD-007")).toBe(true);
    expect(JSON.stringify(views)).not.toContain("OWNER_MANUAL");
    expect(JSON.stringify(views)).not.toContain("LLM_SEMANTIC");
    expect(JSON.stringify(views)).not.toContain("DETERMINISTIC");
  });

  it("updates owner finding after answer change without duplicates", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await factWithEvidence(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "lead-form"
    });
    await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
      contextKey: "lead-form",
      answer: { type: "SINGLE_SELECT", optionId: "NO_BASIS" }
    });
    await persistOwnerFindingsForScan(db, scan);
    await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
      contextKey: "lead-form",
      answer: { type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" }
    });
    await persistOwnerFindingsForScan(db, scan);

    const pd007 = (await getFindingsForScan(db, scan.id)).filter((finding) => finding.ruleId === "PD-007");
    expect(pd007).toHaveLength(1);
    expect(pd007[0].status).toBe("PASS");
  });

  it("does not persist semantic finding on provider technical failure", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await factWithEvidence(db, scan.id, "privacy_policy_text", {
      text: "Текст политики.",
      documentType: "HTML",
      fetchStatus: 200,
      fetchContentType: "text/html",
      contentLimited: false,
      interstitialDetected: false,
      extractionSucceeded: true,
      extractionRoot: "main",
      extractionRootFallback: false,
      truncated: false,
      originalTextLength: 15,
      maxChars: 50_000
    }, "Текст политики.");

    await persistProductionFindings(db, {
      scan,
      facts: await importFacts(db, scan.id),
      evidence: await importEvidence(db, scan.id),
      semanticProvider: new FakeSemanticModelProvider(() => {
        throw new Error("provider unavailable");
      })
    });

    expect((await getFindingsForScan(db, scan.id)).some((finding) => finding.ruleId === "PD-013")).toBe(false);
  });

  it("does not persist PD-019 when policy has no explicit no-transfer claim", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await factWithEvidence(db, scan.id, "external_service_matches", {
      service_name: "Yandex Metrica",
      category: "analytics",
      signal_type: "SCRIPT",
      matched_host: "mc.yandex.ru",
      provider_scope: "RU_PROVIDER",
      semanticCompleteness: "COMPLETE"
    }, "Найден внешний сервис аналитики.");
    await factWithEvidence(db, scan.id, "privacy_policy_text", {
      text: "Политика описывает цели и категории обработки данных.",
      documentType: "HTML",
      fetchStatus: 200,
      fetchContentType: "text/html",
      contentLimited: false,
      interstitialDetected: false,
      extractionSucceeded: true,
      extractionRoot: "main",
      extractionRootFallback: false,
      truncated: false,
      originalTextLength: 51,
      maxChars: 50_000
    }, "Политика описывает цели и категории обработки данных.");

    await persistProductionFindings(db, {
      scan,
      facts: await importFacts(db, scan.id),
      evidence: await importEvidence(db, scan.id),
      semanticProvider: semanticProvider("PRESENT")
    });

    expect((await getFindingsForScan(db, scan.id)).some((finding) => finding.ruleId === "PD-019")).toBe(false);
  });

  it("does not persist owner finding for unresolved applicability", async () => {
    const db = createTestDb();
    const scan = await createScan(db, "ECOMMERCE");
    await factWithEvidence(db, scan.id, "page_language_signal", { found: true });

    await persistOwnerFindingsForScan(db, scan);

    expect((await getFindingsForScan(db, scan.id)).some((finding) => finding.ruleId === "LANG-002")).toBe(false);
  });

  it("binds each semantic pilot rule to its own evidence description and source", async () => {
    const db = createTestDb();
    const scan = await createScan(db, "ECOMMERCE");
    await factWithEvidence(
      db,
      scan.id,
      "consent_text",
      {
        text: "Отдельность согласия: согласие объединено с офертой.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 52,
        maxChars: 50_000
      },
      "Отдельность согласия: согласие объединено с офертой.",
      "https://example.test/consent#separate"
    );
    await factWithEvidence(
      db,
      scan.id,
      "consent_text",
      {
        text: "ТЕКСТ_СОГЛАСИЯ: в тексте согласия нет цели обработки.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 54,
        maxChars: 50_000
      },
      "ТЕКСТ_СОГЛАСИЯ: в тексте согласия нет цели обработки. https://example.test/consent#purpose",
      "https://example.test/consent#purpose"
    );
    await factWithEvidence(
      db,
      scan.id,
      "consent_text",
      {
        text: "Объём согласия: в согласии указан неограниченный объём обработки.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 65,
        maxChars: 50_000
      },
      "Объём согласия: в согласии указан неограниченный объём обработки.",
      "https://example.test/consent#scope"
    );
    await factWithEvidence(
      db,
      scan.id,
      "marketing_consent_control_found",
      {
        found: true,
        text: "Рекламное согласие: рекламное согласие объединено с обязательными условиями.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 78,
        maxChars: 50_000
      },
      "Рекламное согласие: рекламное согласие объединено с обязательными условиями.",
      "https://example.test/consent#marketing"
    );
    await factWithEvidence(
      db,
      scan.id,
      "form_fields",
      {
        formIndex: 0,
        semanticCompleteness: "COMPLETE",
        fields: [
          { label: "Категории формы: имя", personalDataCategories: ["name"] },
          { label: "Категории формы: телефон", personalDataCategories: ["phone"] }
        ]
      },
      "Категории формы: форма собирает имя и телефон.",
      "https://example.test/lead"
    );
    await factWithEvidence(
      db,
      scan.id,
      "form_fields",
      {
        formIndex: 1,
        semanticCompleteness: "COMPLETE",
        fields: [
          { label: "Специальные данные: диагноз", name: "diagnosis", personalDataCategories: [] },
          { label: "Имя", name: "name", personalDataCategories: ["name"] }
        ]
      },
      "Специальные данные: форма содержит поле диагноз.",
      "https://example.test/medical-form"
    );
    await factWithEvidence(
      db,
      scan.id,
      "external_service_matches",
      {
        service_name: "Внешний сервис аналитики",
        category: "analytics",
        signal_type: "SCRIPT",
        matched_host: "analytics.example.test",
        provider_scope: "RU_PROVIDER",
        semanticCompleteness: "COMPLETE"
      },
      "Внешний сервис; Не передаём третьим лицам: найден сервис аналитики.",
      "https://example.test/"
    );
    await factWithEvidence(
      db,
      scan.id,
      "consumer_page_text",
      {
        text: "Порядок претензий: на странице нет порядка подачи претензий.",
        semanticCompleteness: "COMPLETE"
      },
      "Порядок претензий: на странице нет порядка подачи претензий.",
      "https://example.test/offer#claims"
    );
    await factWithEvidence(
      db,
      scan.id,
      "paid_addon_control_found",
      {
        found: true,
        text: "Платная услуга: платная настройка обязательна для оформления заказа.",
        semanticCompleteness: "COMPLETE"
      },
      "Платная услуга: платная настройка обязательна для оформления заказа.",
      "https://example.test/checkout#addon"
    );
    await factWithEvidence(
      db,
      scan.id,
      "recommendation_technology_confirmed",
      {
        found: true
      },
      "На сайте используются рекомендательные технологии.",
      "https://example.test/"
    );
    await factWithEvidence(
      db,
      scan.id,
      "recommendation_rules_text",
      {
        text: "Правила рекомендаций: страница доступна только после входа.",
        semanticCompleteness: "COMPLETE"
      },
      "Правила рекомендаций: страница доступна только после входа.",
      "https://example.test/recommendations#rules"
    );
    await factWithEvidence(
      db,
      scan.id,
      "consumer_page_text",
      {
        text: "Русский язык: Return policy is available in English only.",
        semanticCompleteness: "COMPLETE"
      },
      "Русский язык: Return policy is available in English only.",
      "https://example.test/return#language"
    );
    await factWithEvidence(
      db,
      scan.id,
      "privacy_policy_text",
      {
        text: "ЦЕЛИ_ОБРАБОТКИ: в документе нет целей обработки.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 48,
        maxChars: 50_000
      },
      "ЦЕЛИ_ОБРАБОТКИ: в документе нет целей обработки.",
      "https://example.test/privacy#purposes"
    );
    await factWithEvidence(
      db,
      scan.id,
      "privacy_policy_text",
      {
        text: "КАТЕГОРИИ_ДАННЫХ: в документе нет категорий данных.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 54,
        maxChars: 50_000
      },
      "КАТЕГОРИИ_ДАННЫХ: в документе нет категорий данных.",
      "https://example.test/privacy#categories"
    );
    await factWithEvidence(
      db,
      scan.id,
      "privacy_policy_text",
      {
        text: "СРОКИ_ХРАНЕНИЯ: в документе нет сроков хранения.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 50,
        maxChars: 50_000
      },
      "СРОКИ_ХРАНЕНИЯ: в документе нет сроков хранения.",
      "https://example.test/privacy#retention"
    );
    await factWithEvidence(
      db,
      scan.id,
      "privacy_policy_text",
      {
        text: "ПОРЯДОК_ОБРАЩЕНИЙ: в документе нет порядка обращений.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 57,
        maxChars: 50_000
      },
      "ПОРЯДОК_ОБРАЩЕНИЙ: в документе нет порядка обращений.",
      "https://example.test/privacy#requests"
    );
    await factWithEvidence(
      db,
      scan.id,
      "privacy_policy_text",
      {
        text: "Категории формы: в политике нет телефона.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 39,
        maxChars: 50_000
      },
      "Категории формы: в политике нет телефона.",
      "https://example.test/privacy#form-categories"
    );
    await factWithEvidence(
      db,
      scan.id,
      "privacy_policy_text",
      {
        text: "Внешний сервис: в политике нет аналитики.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 41,
        maxChars: 50_000
      },
      "Внешний сервис: в политике нет аналитики.",
      "https://example.test/privacy#services"
    );
    await factWithEvidence(
      db,
      scan.id,
      "privacy_policy_text",
      {
        text: "Не передаём третьим лицам: персональные данные третьим лицам не передаются.",
        documentType: "HTML",
        fetchStatus: 200,
        fetchContentType: "text/html",
        contentLimited: false,
        interstitialDetected: false,
        extractionSucceeded: true,
        extractionRoot: "main",
        extractionRootFallback: false,
        truncated: false,
        originalTextLength: 76,
        maxChars: 50_000
      },
      "Не передаём третьим лицам: персональные данные третьим лицам не передаются.",
      "https://example.test/privacy#no-transfer"
    );

    await persistProductionFindings(db, {
      scan,
      facts: await importFacts(db, scan.id),
      evidence: await importEvidence(db, scan.id),
      semanticProvider: ruleSpecificSemanticProvider()
    });

    const findings = await getFindingsForScan(db, scan.id);
    const evidenceByFindingId = Object.fromEntries(await Promise.all(findings.map(async (finding) => {
      const ids = await getEvidenceIdsForFinding(db, finding.id);
      return [finding.id, await getEvidenceByIds(db, ids)];
    })));
    const views = buildFindingViewModels(findings, evidenceByFindingId);
    const pd005 = views.find((finding) => finding.ruleId === "PD-005")!;
    const pd008 = views.find((finding) => finding.ruleId === "PD-008")!;
    const pd009 = views.find((finding) => finding.ruleId === "PD-009")!;
    const pd010 = views.find((finding) => finding.ruleId === "PD-010")!;
    const pd013 = views.find((finding) => finding.ruleId === "PD-013")!;
    const pd014 = views.find((finding) => finding.ruleId === "PD-014")!;
    const pd015 = views.find((finding) => finding.ruleId === "PD-015")!;
    const pd016 = views.find((finding) => finding.ruleId === "PD-016")!;
    const pd017 = views.find((finding) => finding.ruleId === "PD-017")!;
    const pd018 = views.find((finding) => finding.ruleId === "PD-018")!;
    const pd019 = views.find((finding) => finding.ruleId === "PD-019")!;
    const pd024 = views.find((finding) => finding.ruleId === "PD-024")!;
    const ec010 = views.find((finding) => finding.ruleId === "EC-010")!;
    const ec012 = views.find((finding) => finding.ruleId === "EC-012")!;
    const rec003 = views.find((finding) => finding.ruleId === "REC-003")!;
    const lang001 = views.find((finding) => finding.ruleId === "LANG-001")!;

    expect(pd005.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/consent#separate",
      detail: expect.stringContaining("согласие объединено с офертой")
    });
    expect(pd008.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/consent#purpose",
      detail: expect.stringContaining("в тексте согласия нет цели обработки")
    });
    expect(pd009.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/consent#scope",
      detail: expect.stringContaining("в согласии указан неограниченный объём обработки")
    });
    expect(pd010.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/consent#marketing",
      detail: expect.stringContaining("рекламное согласие объединено с обязательными условиями")
    });
    expect(pd013.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/privacy#purposes",
      detail: expect.stringContaining("в документе нет целей обработки")
    });
    expect(pd014.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/privacy#categories",
      detail: expect.stringContaining("в документе нет категорий данных")
    });
    expect(pd015.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/privacy#retention",
      detail: expect.stringContaining("в документе нет сроков хранения")
    });
    expect(pd016.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/privacy#requests",
      detail: expect.stringContaining("в документе нет порядка обращений")
    });
    expect(pd017.evidence.map((item) => item.pageUrl)).toEqual(
      expect.arrayContaining(["https://example.test/lead", "https://example.test/privacy#form-categories"])
    );
    expect(pd018.evidence.map((item) => item.pageUrl)).toEqual(
      expect.arrayContaining(["https://example.test/", "https://example.test/privacy#services"])
    );
    expect(pd019.evidence.map((item) => item.pageUrl)).toEqual(
      expect.arrayContaining(["https://example.test/", "https://example.test/privacy#no-transfer"])
    );
    expect(pd024.status).toBe("MANUAL_CHECK");
    expect(pd024.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/medical-form",
      detail: expect.stringContaining("форма содержит поле диагноз")
    });
    expect(ec010.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/offer#claims",
      detail: expect.stringContaining("на странице нет порядка подачи претензий")
    });
    expect(ec012.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/checkout#addon",
      detail: expect.stringContaining("платная настройка обязательна")
    });
    expect(rec003.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/recommendations#rules",
      detail: expect.stringContaining("страница доступна только после входа")
    });
    expect(lang001.evidence[0]).toMatchObject({
      pageUrl: "https://example.test/return#language",
      detail: expect.stringContaining("Return policy is available in English only")
    });

    const pilotViews = [pd005, pd008, pd009, pd010, pd013, pd014, pd015, pd016, pd017, pd018, pd019, pd024, ec010, ec012, rec003, lang001];
    const rendered = JSON.stringify(pilotViews.map((finding) => finding.evidence));
    expect(rendered).not.toContain("ТЕКСТ_СОГЛАСИЯ");
    expect(rendered).not.toContain("ЦЕЛИ_ОБРАБОТКИ");
    expect(rendered).not.toContain("КАТЕГОРИИ_ДАННЫХ");
    expect(rendered).not.toContain("СРОКИ_ХРАНЕНИЯ");
    expect(rendered).not.toContain("ПОРЯДОК_ОБРАЩЕНИЙ");
    expect(rendered).not.toContain("Специальные данные:");
    expect(rendered).not.toContain("Порядок претензий:");
    expect(rendered).not.toContain("Платная услуга:");
    expect(rendered).not.toContain("Правила рекомендаций:");
    expect(rendered).not.toContain("Русский язык:");
    expect(pd008.evidence[0].detail).not.toContain("https://example.test/consent#purpose");
    expect(pd008.evidence[0].detail).not.toContain("согласие объединено с офертой");
    expect(pd008.evidence[0].detail).not.toContain("неограниченный объём обработки");
    expect(pd009.evidence[0].detail).not.toContain("в тексте согласия нет цели обработки");
    expect(pd010.evidence[0].detail).not.toContain("в тексте согласия нет цели обработки");
    expect(pd016.evidence[0].detail).not.toContain("целей обработки");
    expect(pd016.evidence[0].detail).not.toContain("категорий данных");
    expect(pd016.evidence[0].detail).not.toContain("сроков хранения");
  });

  it("uses meaningful owner manual-check text without internal codes", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await factWithEvidence(db, scan.id, "personal_data_collection_found", { found: true });
    await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_PD_PRIMARY_DB_LOCATION",
      answer: { type: "SINGLE_SELECT", optionId: "FOREIGN_FIRST" }
    });

    await persistOwnerFindingsForScan(db, scan);

    const pd022 = (await getFindingsForScan(db, scan.id)).find((finding) => finding.ruleId === "PD-022")!;
    expect(pd022.status).toBe("MANUAL_CHECK");
    expect(pd022.remediation).toBe(
      "Уточните, где происходит первичная запись персональных данных пользователей: в России или за её пределами."
    );
    expect(pd022.missingContext).toEqual(["Уточните место первичной записи персональных данных пользователей."]);
    expect(JSON.stringify(pd022)).not.toContain("RULE_POLICY_REQUIRES_MANUAL_CHECK");
    expect(JSON.stringify(pd022)).not.toContain("Ответ владельца требует ручной проверки");
    expect(JSON.stringify(pd022)).not.toContain("Нужна дополнительная проверка");
  });

  it("keeps the passed section markup free of nested disclosure and list artifacts", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "app", "results", "[scanId]", "page.tsx"), "utf8");

    expect(source).toContain('<details className="pass-details">');
    expect(source).toContain("<summary>Проверка пройдена: {passFindings.length}</summary>");
    expect(source).toContain('className="pass-item"');
    expect(source).not.toContain('<ul className="pass-list"');
    expect(source.match(/<details/g) ?? []).toHaveLength(1);
    expect(source.match(/<summary/g) ?? []).toHaveLength(1);
  });
});

async function importFacts(db: Queryable, scanId: string) {
  const { getFactsForScan } = await import("@/db/repository");
  return getFactsForScan(db, scanId);
}

async function importEvidence(db: Queryable, scanId: string) {
  const { getEvidenceForScan } = await import("@/db/repository");
  return getEvidenceForScan(db, scanId);
}
