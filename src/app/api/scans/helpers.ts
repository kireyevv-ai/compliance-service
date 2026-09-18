import { z } from "zod";
import { getPool, type Queryable } from "@/db/client";
import {
  createQueuedScan,
  createSite,
  getEvidenceByIds,
  getEvidenceForScan,
  getEvidenceIdsForFinding,
  getFactsForScan,
  getFindingsForScan,
  getScanById,
  getSiteById,
  getSiteByUserAndNormalizedDomain,
  upsertUser
} from "@/db/repository";
import { SITE_TYPES } from "@/db/schema";
import { DEVELOPMENT_USER_ID } from "@/db/seed-dev-user";
import { normalizeUserUrl } from "@/scanner/normalization/url";
import { formatExternalServices } from "@/app/results/presentation";
import { loadRuntimeRules } from "@/legal-rules/runtime";
import { evaluateRulesForScan } from "@/rule-engine/evaluator";

const startScanSchema = z.object({
  url: z.string().trim().min(1, "Адрес сайта обязателен"),
  siteType: z.enum(SITE_TYPES, { error: "Тип сайта обязателен" })
});

const SCANNER_VERSION = "task008-ui-flow";

type StartScanOptions = {
  db?: Queryable;
};

export async function startScan(input: unknown, options: StartScanOptions = {}) {
  const parsed = startScanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      error: parsed.error.issues[0]?.message ?? "Проверьте данные формы"
    };
  }

  let normalized;
  try {
    normalized = normalizeUserUrl(parsed.data.url);
  } catch {
    return { ok: false as const, status: 400, error: "Введите корректный адрес сайта" };
  }

  const db = options.db ?? getPool();
  await upsertUser(db, { id: DEVELOPMENT_USER_ID, email: "dev@example.local" });

  const existingSite = await getSiteByUserAndNormalizedDomain(db, {
    userId: DEVELOPMENT_USER_ID,
    normalizedDomain: normalized.normalizedDomain
  });
  const site =
    existingSite ??
    (await createSite(db, {
      userId: DEVELOPMENT_USER_ID,
      url: normalized.canonicalStartUrl,
      normalizedDomain: normalized.normalizedDomain
    }));
  const scan = await createQueuedScan(db, {
    siteId: site.id,
    siteType: parsed.data.siteType,
      scannerVersion: SCANNER_VERSION
  });

  return {
    ok: true as const,
    status: 202,
    scanId: scan.id,
    siteDomain: site.normalizedDomain,
    statusValue: scan.status
  };
}

export async function getScanResult(scanId: string) {
  if (!z.string().uuid().safeParse(scanId).success) {
    return { ok: false as const, status: 400, error: "Некорректный идентификатор проверки" };
  }

  const db = getPool();
  const scan = await getScanById(db, scanId);
  if (!scan) {
    return { ok: false as const, status: 404, error: "Проверка не найдена" };
  }

  const site = await getSiteById(db, scan.siteId);
  const findings = await getFindingsForScan(db, scan.id);
  const evidenceByFindingId: Record<string, Awaited<ReturnType<typeof getEvidenceByIds>>> = {};

  for (const finding of findings) {
    const evidenceIds = await getEvidenceIdsForFinding(db, finding.id);
    evidenceByFindingId[finding.id] = await getEvidenceByIds(db, evidenceIds);
  }

  const facts = await getFactsForScan(db, scan.id);
  const externalServiceFact = facts.find((fact) => fact.factType === "external_service_detected");
  const coverageFact = facts.find((fact) => fact.factType === "scan_coverage");
  const coverage = coverageFact
    ? {
        contentLimited: coverageFact.value.contentLimited === true,
        limitationReason:
          typeof coverageFact.value.limitationReason === "string" ? coverageFact.value.limitationReason : null,
        successfulHtmlPages: numberValue(coverageFact.value.successfulHtmlPages),
        httpErrorPages: numberValue(coverageFact.value.httpErrorPages),
        pagesVisited: numberValue(coverageFact.value.pagesVisited),
        maxPagesReached: coverageFact.value.maxPagesReached === true
      }
    : null;
  const rules = loadRuntimeRules();
  const evaluations = evaluateRulesForScan({ scan, facts, evidence: await getEvidenceForScan(db, scan.id), rules });
  const applicableEvaluations = evaluations.filter((evaluation) => !isNotApplicableReason(reasonFor(evaluation)));
  const evaluatedCount = evaluations.filter((evaluation) => evaluation.status !== "NO_EVALUATION").length;

  return {
    ok: true as const,
    status: 200,
    scan,
    site,
    findings,
    evidenceByFindingId,
    externalServices: externalServiceFact ? formatExternalServices(externalServiceFact.value) : [],
    coverage,
    contentLimited: coverage?.contentLimited === true,
    contentLimitationReason: coverage?.limitationReason ?? null,
    ruleEvaluationSummary: {
      applicableCount: applicableEvaluations.length,
      evaluatedCount,
      notEvaluatedCount: applicableEvaluations.length - evaluatedCount
    },
    noEvaluationResults: applicableEvaluations.filter((evaluation) => evaluation.status === "NO_EVALUATION")
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isNotApplicableReason(reason: string | undefined): boolean {
  return Boolean(reason?.startsWith("Rule does not apply to "));
}

function reasonFor(evaluation: { status: string; reason?: string }): string | undefined {
  return evaluation.status === "NO_EVALUATION" ? evaluation.reason : undefined;
}

export function userSafeScanError(reason?: string | null): string | undefined {
  if (!reason) {
    return undefined;
  }

  if (/sql|database|stack|node_modules|:\\\\|\/src\//i.test(reason)) {
    return undefined;
  }

  if (reason === "HTTP request timeout") {
    return "Сайт не ответил за отведённое время. Попробуйте позже.";
  }

  if (reason === "Response body too large" || reason === "RESPONSE_BODY_TOO_LARGE") {
    return "Проверка завершилась ошибкой. Попробуйте позже.";
  }

  return "Проверка завершилась ошибкой. Попробуйте позже.";
}
