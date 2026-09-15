import { randomUUID } from "node:crypto";
import { loadLocalEnv } from "@/config/env";
import { getPool } from "@/db/client";
import {
  claimQueuedScanById,
  completeScan,
  createEvidence,
  createFact,
  createQueuedScan,
  createSite,
  upsertUser
} from "@/db/repository";
import { persistProductionFindings } from "@/findings/integration";
import { FakeSemanticModelProvider } from "@/semantic-evaluator/fake-provider";
import type { SemanticModelRequest } from "@/semantic-evaluator/types";

loadLocalEnv();

async function main() {
  assertLocalSmokeEnvironment();
  const pool = getPool();

  try {
    const suffix = randomUUID();
    const user = await upsertUser(pool, { email: `final-smoke-${suffix}@example.test` });
    const site = await createSite(pool, {
      userId: user.id,
      url: `https://final-smoke-${suffix}.example.test/`,
      normalizedDomain: `final-smoke-${suffix}.example.test`
    });
    const queuedScan = await createQueuedScan(pool, {
      siteId: site.id,
      siteType: "B2B",
      scannerVersion: "final-integration-smoke"
    });
    const scan = await claimQueuedScanById(pool, queuedScan.id);

    if (!scan) {
      throw new Error("Не удалось подготовить проверку");
    }

    await factWithEvidence(pool, scan.id, "scan_coverage", {
      crawlCompleted: true,
      contentLimited: false,
      successfulHtmlPages: 1,
      httpErrorPages: 0
    }, "Проверена главная страница сайта.");
    await factWithEvidence(pool, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "lead-form",
      formLabel: "Заказать консультацию",
      pageTitle: "Контакты",
      fields: ["name", "phone", "email"]
    }, "Форма «Заказать консультацию» собирает имя, телефон и электронную почту.");
    await factWithEvidence(pool, scan.id, "privacy_policy_link_found", { found: true }, "Найдена ссылка на политику обработки персональных данных.");
    await factWithEvidence(pool, scan.id, "consent_text", {
      text: "ТЕКСТ_СОГЛАСИЯ: текст согласия не содержит понятного описания цели обработки.",
      documentType: "HTML",
      fetchStatus: 200,
      fetchContentType: "text/html",
      contentLimited: false,
      interstitialDetected: false,
      extractionSucceeded: true,
      extractionRoot: "main",
      extractionRootFallback: false,
      truncated: false,
      originalTextLength: 77,
      maxChars: 50_000
    }, "ТЕКСТ_СОГЛАСИЯ: текст согласия не содержит понятного описания цели обработки.", "https://final-smoke.example.test/contacts#consent");
    await factWithEvidence(pool, scan.id, "privacy_policy_text", {
      text: "ЦЕЛИ_ОБРАБОТКИ: политика не содержит понятного описания целей обработки.",
      documentType: "HTML",
      fetchStatus: 200,
      fetchContentType: "text/html",
      contentLimited: false,
      interstitialDetected: false,
      extractionSucceeded: true,
      extractionRoot: "main",
      extractionRootFallback: false,
      truncated: false,
      originalTextLength: 70,
      maxChars: 50_000
    }, "ЦЕЛИ_ОБРАБОТКИ: политика не содержит понятного описания целей обработки.", "https://final-smoke.example.test/policy#purposes");
    await factWithEvidence(pool, scan.id, "privacy_policy_text", {
      text: "КАТЕГОРИИ_ДАННЫХ: политика не перечисляет категории персональных данных.",
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
    }, "КАТЕГОРИИ_ДАННЫХ: политика не перечисляет категории персональных данных.", "https://final-smoke.example.test/policy#categories");
    await factWithEvidence(pool, scan.id, "privacy_policy_text", {
      text: "СРОКИ_ХРАНЕНИЯ: политика не описывает сроки хранения или порядок удаления.",
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
    }, "СРОКИ_ХРАНЕНИЯ: политика не описывает сроки хранения или порядок удаления.", "https://final-smoke.example.test/policy#retention");
    await factWithEvidence(pool, scan.id, "privacy_policy_text", {
      text: "ПОРЯДОК_ОБРАЩЕНИЙ: политика не описывает, как пользователь может обратиться по своим персональным данным.",
      documentType: "HTML",
      fetchStatus: 200,
      fetchContentType: "text/html",
      contentLimited: false,
      interstitialDetected: false,
      extractionSucceeded: true,
      extractionRoot: "main",
      extractionRootFallback: false,
      truncated: false,
      originalTextLength: 104,
      maxChars: 50_000
    }, "ПОРЯДОК_ОБРАЩЕНИЙ: политика не описывает, как пользователь может обратиться по своим персональным данным.", "https://final-smoke.example.test/policy#requests");

    await persistProductionFindings(pool, {
      scan,
      facts: await factsFor(pool, scan.id),
      evidence: await evidenceFor(pool, scan.id),
      semanticProvider: semanticProvider("ABSENT")
    });
    await completeScan(pool, scan.id);

    console.log(`Full journey URL: ${localAppOrigin()}/scan/${scan.id}`);
    console.log(`Owner questions URL: ${localAppOrigin()}/owner-context/${scan.id}`);
    console.log(`Results URL: ${localAppOrigin()}/results/${scan.id}`);
  } finally {
    await pool.end();
  }
}

async function factWithEvidence(
  db: ReturnType<typeof getPool>,
  scanId: string,
  factType: string,
  value: Record<string, unknown>,
  text: string,
  sourceUrl = "https://final-smoke.example.test/"
) {
  const fact = await createFact(db, {
    scanId,
    pageUrl: sourceUrl,
    factType,
    value
  });
  await createEvidence(db, {
    scanId,
    factId: fact.id,
    evidenceType: "TEXT_FRAGMENT",
    pageUrl: "https://final-smoke.example.test/",
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
}

async function factsFor(db: ReturnType<typeof getPool>, scanId: string) {
  const { getFactsForScan } = await import("@/db/repository");
  return getFactsForScan(db, scanId);
}

async function evidenceFor(db: ReturnType<typeof getPool>, scanId: string) {
  const { getEvidenceForScan } = await import("@/db/repository");
  return getEvidenceForScan(db, scanId);
}

function semanticProvider(observation: "PRESENT" | "ABSENT" | "AMBIGUOUS") {
  const markers: Record<string, string> = {
    "PD-008": "ТЕКСТ_СОГЛАСИЯ",
    "PD-013": "ЦЕЛИ_ОБРАБОТКИ",
    "PD-014": "КАТЕГОРИИ_ДАННЫХ",
    "PD-015": "СРОКИ_ХРАНЕНИЯ",
    "PD-016": "ПОРЯДОК_ОБРАЩЕНИЙ"
  };
  return new FakeSemanticModelProvider((request: SemanticModelRequest) => {
    const marker = markers[request.ruleId];
    const evidenceRefs = request.evidence
      .filter((item) => !marker || item.excerpt.includes(marker))
      .map((item) => item.ref);

    return {
      observation,
      confidence: 0.86,
      reason_code: `${observation}_SMOKE`,
      reason: "Synthetic semantic smoke result.",
      evidence_refs: evidenceRefs
    };
  });
}

function assertLocalSmokeEnvironment(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Final integration smoke seed must not run with NODE_ENV=production");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const url = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Final integration smoke seed requires a local database host");
  }
}

function localAppOrigin(): string {
  const port = process.env.PORT?.trim() || "3000";
  return `http://localhost:${port}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Final integration smoke seed failed");
  process.exit(1);
});
