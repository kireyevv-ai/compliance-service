import type { Evidence } from "@/evidence/types";
import type { Finding } from "@/findings/types";
import { OWNER_FINDING_METADATA, SEMANTIC_LEGAL_BASIS } from "@/findings/integration";
import { loadRuntimeRules } from "@/legal-rules/runtime";

export const EMPTY_RESULT_TITLE = "Проблем не выявлено.";
export const EMPTY_RESULT_NOTE =
  "Проверка охватывает только параметры, доступные в текущей версии сервиса.";
export const SCOPE_DISCLAIMER =
  "Проверка носит информационный характер и охватывает только автоматизированные проверки, доступные в текущей версии сервиса.";

export type CoverageOutcomeKind =
  | "ANALYSIS_AVAILABLE"
  | "PARTIAL"
  | "ACCESS_PROTECTED"
  | "RATE_LIMITED"
  | "NETWORK_UNAVAILABLE";

export interface CoverageSnapshot {
  contentLimited?: boolean;
  limitationReason?: string | null;
  successfulHtmlPages?: number;
  httpErrorPages?: number;
  pagesVisited?: number;
  maxPagesReached?: boolean;
}

export interface CoverageOutcome {
  kind: CoverageOutcomeKind;
  blocksResults: boolean;
  title: string;
  message: string;
}

export function coverageOutcomeForResult(input: {
  scanStatus: string;
  statusReason?: string | null;
  coverage?: CoverageSnapshot | null;
}): CoverageOutcome {
  const reason = input.coverage?.limitationReason ?? input.statusReason ?? "";
  const successfulHtmlPages = Number(input.coverage?.successfulHtmlPages ?? 0);
  const pagesVisited = Number(input.coverage?.pagesVisited ?? 0);

  if (isScanDeadlineReason(reason) && successfulHtmlPages === 0) {
    return {
      kind: "NETWORK_UNAVAILABLE",
      blocksResults: true,
      title: "Не удалось проверить сайт",
      message:
        "Проверка заняла слишком много времени и была остановлена. Сайт не удалось достаточно прочитать, поэтому оценить его соответствие требованиям невозможно."
    };
  }

  if (input.scanStatus === "FAILED" && /timeout|network|timed?\s*out/i.test(input.statusReason ?? "")) {
    return {
      kind: "NETWORK_UNAVAILABLE",
      blocksResults: true,
      title: "Не удалось проверить сайт",
      message:
        "Сайт не ответил вовремя или оказался недоступен для проверки. Оценить соответствие сайта требованиям сейчас невозможно."
    };
  }

  if (isRateLimitReason(reason) && successfulHtmlPages === 0) {
    return {
      kind: "RATE_LIMITED",
      blocksResults: true,
      title: "Не удалось проверить сайт",
      message:
        "Сайт временно ограничил автоматические запросы. Проверка не выполнена. Попробуйте повторить её позже."
    };
  }

  if (isAccessProtectionReason(reason) && (successfulHtmlPages === 0 || pagesVisited <= 1)) {
    return {
      kind: "ACCESS_PROTECTED",
      blocksResults: true,
      title: "Не удалось проверить сайт",
      message:
        "Сайт защищён от автоматического доступа. Система не смогла получить содержимое страниц, поэтому оценить соответствие сайта требованиям невозможно."
    };
  }

  if (input.scanStatus === "COMPLETED" && successfulHtmlPages === 0) {
    return {
      kind: isRateLimitReason(reason) ? "RATE_LIMITED" : "NETWORK_UNAVAILABLE",
      blocksResults: true,
      title: "Не удалось проверить сайт",
      message: isRateLimitReason(reason)
        ? "Сайт временно ограничил автоматические запросы. Проверка не выполнена. Попробуйте повторить её позже."
        : "Сайт не ответил вовремя или оказался недоступен для проверки. Оценить соответствие сайта требованиям сейчас невозможно."
    };
  }

  if (input.coverage?.contentLimited === true || input.coverage?.maxPagesReached === true || Number(input.coverage?.httpErrorPages ?? 0) > 0) {
    return {
      kind: "PARTIAL",
      blocksResults: false,
      title: "Анализ выполнен частично",
      message:
        "Часть сайта была недоступна для проверки. Результаты относятся только к успешно прочитанным страницам."
    };
  }

  return {
    kind: "ANALYSIS_AVAILABLE",
    blocksResults: false,
    title: "Проверка выполнена",
    message: ""
  };
}

export function resultsHeaderSummaryText(summary: {
  fail: number;
  warning: number;
  manual: number;
  pass: number;
}) {
  const evaluatedCount = summary.fail + summary.warning + summary.manual + summary.pass;
  const problemCount = summary.fail + summary.warning + summary.manual;

  return {
    checkedText: `Проверено ${evaluatedCount} параметров сайта.`,
    issueText: problemCount === 0 ? "Проблем не выявлено." : `Выявлено ${problemCount} проблем.`
  };
}

function isAccessProtectionReason(reason: string): boolean {
  return /(anti.?bot|challenge|captcha|security|interstitial|access protection|access denied|forbidden|bot|vpnchee?ck|limited-content interstitial)/i.test(reason);
}

function isRateLimitReason(reason: string): boolean {
  return /(HTTP\s*)?429|rate.?limit|too many requests/i.test(reason);
}

function isScanDeadlineReason(reason: string): boolean {
  return /scan_total_timeout|scan total timeout|scan deadline/i.test(reason);
}

export type FindingGroup = "fix" | "attention" | "manual" | "passed";

export interface FindingViewModel {
  id: string;
  ruleId: string;
  status: Finding["status"];
  group: FindingGroup;
  statusLabel: string;
  summary: string;
  explanation: string;
  remediation: string;
  legalBasis: string[];
  evidence: EvidenceViewModel[];
  missingContext: string[];
}

export interface EvidenceViewModel {
  pageUrl: string;
  label: string;
  detail?: string;
  links: EvidenceLinkViewModel[];
}

export interface EvidenceLinkViewModel {
  url: string;
  label: string;
}

const STATUS_ORDER: Record<Finding["status"], number> = {
  FAIL: 0,
  WARNING: 1,
  MANUAL_CHECK: 2,
  PASS: 3
};

const STATUS_LABELS: Record<Finding["status"], string> = {
  FAIL: "Требует исправления",
  WARNING: "Требует внимания",
  MANUAL_CHECK: "Нужна дополнительная проверка",
  PASS: "Пройдено"
};

const STATUS_GROUPS: Record<Finding["status"], FindingGroup> = {
  FAIL: "fix",
  WARNING: "attention",
  MANUAL_CHECK: "manual",
  PASS: "passed"
};

const PD001_NO_FORMS_SUMMARY =
  "На проверенных страницах не обнаружены формы, собирающие персональные данные.";

export function summarizeFindings(findings: Pick<Finding, "status">[]) {
  return {
    fail: findings.filter((finding) => finding.status === "FAIL").length,
    warning: findings.filter((finding) => finding.status === "WARNING").length,
    manual: findings.filter((finding) => finding.status === "MANUAL_CHECK").length,
    pass: findings.filter((finding) => finding.status === "PASS").length
  };
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const byStatus = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
    return byStatus !== 0 ? byStatus : left.ruleId.localeCompare(right.ruleId);
  });
}

export function buildFindingViewModels(
  findings: Finding[],
  evidenceByFindingId: Record<string, Evidence[]>
): FindingViewModel[] {
  const rulePresentationById = new Map<string, { legalBasis: string[]; passSummary?: string }>(
    [
      ...loadRuntimeRules().map((rule) => [
      rule.ruleId,
      {
        legalBasis: rule.legalBasis,
        passSummary: rule.passSummary
      }
      ] as const),
      ...Object.entries(OWNER_FINDING_METADATA).map(([ruleId, metadata]) => [
        ruleId,
        {
          legalBasis: metadata.legalBasis,
          passSummary: metadata.summary.pass
        }
      ] as const),
      ...Object.entries(SEMANTIC_LEGAL_BASIS).map(([ruleId, legalBasis]) => [
        ruleId,
        {
          legalBasis,
          passSummary: undefined
        }
      ] as const)
    ]
  );

  return sortFindings(findings).map((finding) => {
    const rulePresentation = rulePresentationById.get(finding.ruleId);

    return {
      id: finding.id,
      ruleId: finding.ruleId,
      status: finding.status,
      group: STATUS_GROUPS[finding.status],
      statusLabel: STATUS_LABELS[finding.status],
      summary: summaryForFinding(finding, rulePresentation?.passSummary),
      explanation: finding.explanation,
      remediation: finding.remediation,
      legalBasis: rulePresentation?.legalBasis ?? [],
      evidence: formatFindingEvidence(finding.ruleId, evidenceByFindingId[finding.id] ?? []),
      missingContext: finding.missingContext
    };
  });
}

function summaryForFinding(finding: Finding, passSummary?: string): string {
  if (finding.status !== "PASS") {
    return finding.summary;
  }

  if (finding.ruleId === "PD-001" && finding.summary === PD001_NO_FORMS_SUMMARY) {
    return finding.summary;
  }

  return passSummary ?? finding.summary;
}

export function formatExternalServices(value: unknown): string[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { services?: unknown[] }).services)) {
    return [];
  }

  return (value as { services: Array<{ service_name?: unknown }> }).services
    .map((service) => (typeof service.service_name === "string" ? service.service_name : undefined))
    .filter((name): name is string => Boolean(name));
}

function formatFindingEvidence(ruleId: string, evidence: Evidence[]): EvidenceViewModel[] {
  const formatted = evidence
    .map((item) => formatEvidence(ruleId, item))
    .filter((item) => item.detail || item.links.length > 0 || item.pageUrl);
  const unique = new Map<string, EvidenceViewModel>();

  for (const item of formatted) {
    const description = item.detail ?? item.links.map((link) => link.label).join(" ");
    const key = [normalizePresentationKey(item.pageUrl), normalizePresentationKey(description)].join("::");
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  return [...unique.values()].slice(0, maxEvidenceItems(ruleId));
}

function maxEvidenceItems(ruleId: string): number {
  return ruleId === "EC-001" || ruleId === "EC-013" || ruleId.startsWith("PD-") ? 3 : 6;
}

function formatEvidence(ruleId: string, evidence: Evidence): EvidenceViewModel {
  const payload = evidence.payload ?? {};
  const links = evidenceLinks(payload);
  const sourceUrl = sourceUrlForEvidence(evidence, payload);
  const detail = userFacingEvidenceDetail(ruleId, payload, sourceUrl);

  return {
    pageUrl: sourceUrl,
    label: evidenceLabel(ruleId, evidence.evidenceType, payload),
    detail: detail ? compact(detail, 160) : undefined,
    links
  };
}

function userFacingEvidenceDetail(
  ruleId: string,
  payload: Record<string, unknown>,
  sourceUrl: string
): string | undefined {
  if (isInternalOnlyPayload(payload)) {
    return undefined;
  }

  const maskedValue = textValue(payload.maskedValue);
  if (maskedValue) {
    return maskedValue;
  }

  const value = textValue(payload.value);
  if (value) {
    return value;
  }

  const context = textValue(payload.context);
  const extracted = contextValue(ruleId, context);
  if (extracted) {
    return extracted;
  }

  if (ruleId === "PD-001" && typeof payload.fragment === "string") {
    return "Форма сбора персональных данных";
  }

  const amount = numberValue(payload.amount);
  const currencyMarker = textValue(payload.currencyMarker);
  if (amount !== undefined && currencyMarker) {
    return `${formatAmount(amount)} ${currencyMarker}`;
  }

  const text = shortText(
    cleanEvidenceText(textValue(payload.text) ?? textValue(payload.title) ?? textValue(payload.ariaLabel), sourceUrl)
  );
  const cleanContext = shortText(context && !isInternalContext(context) ? cleanEvidenceText(context, sourceUrl) : undefined);
  const detailParts = uniqueTextParts([text, cleanContext]);

  if (isPolicyOrOfferRule(ruleId)) {
    return compact(detailParts.join(" · "), 160) || cleanContext;
  }

  return compact(detailParts.join(" · "), 420) || undefined;
}

function evidenceLabel(ruleId: string, evidenceType: string, payload: Record<string, unknown>): string {
  if (ruleId === "PD-001" && typeof payload.fragment === "string") {
    return "Форма сбора персональных данных";
  }

  if (isPolicyOrOfferRule(ruleId) && evidenceLinks(payload).length > 0) {
    return ruleId.startsWith("PD-") ? "Ссылка на политику" : "Ссылка на оферту";
  }

  if (evidenceType === "DOM_FRAGMENT") {
    return "Фрагмент страницы";
  }

  if (evidenceType === "TEXT") {
    return "Текст на странице";
  }

  if (evidenceType === "TEXT_FRAGMENT") {
    return "Текст на странице";
  }

  if (evidenceType === "SCREENSHOT") {
    return "Снимок страницы";
  }

  return "Источник";
}

function evidenceLinks(payload: Record<string, unknown>): EvidenceLinkViewModel[] {
  const urls = [
    textValue(payload.sanitized_url),
    textValue(payload.url),
    textValue(payload.actionUrl),
    ...sourceUrls(payload.sources)
  ].filter((url): url is string => Boolean(url && isHttpUrl(url)));

  return [...new Set(urls)].map((url) => ({
    url,
    label: url
  }));
}

function sourceUrlForEvidence(evidence: Evidence, payload: Record<string, unknown>): string {
  const sourceUrl = textValue(payload.sourceUrl);
  if (sourceUrl && isHttpUrl(sourceUrl)) {
    return sourceUrl;
  }
  return evidence.pageUrl;
}

function sourceUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      return textValue((item as { url?: unknown }).url);
    })
    .filter((url): url is string => Boolean(url));
}

function isInternalOnlyPayload(payload: Record<string, unknown>): boolean {
  const context = textValue(payload.context);
  return Boolean(context && isInternalContext(context) && !payload.url && !payload.value && !payload.maskedValue);
}

function contextValue(ruleId: string, context: string | undefined): string | undefined {
  if (!context || isInternalContext(context)) {
    return undefined;
  }

  if (ruleId === "EC-006" || ruleId === "EC-009") {
    return firstMatch(context, /([A-Za-zА-Яа-я]\*{3}@[A-Za-z0-9.-]+\.(?:ru|рф|com|net|org))/iu)
      ?? firstMatch(context, /(\+7\s+\*{3}\s+\*{3}\s+\*{2}\s+\d{2})/u);
  }

  if (ruleId === "EC-013") {
    return firstDiscountedRublePrice(context) ?? firstMatch(context, /(\d[\d ]{0,8}\s*₽)/u);
  }

  if (ruleId === "EC-003" || ruleId === "CON-001") {
    return firstMatch(context, /((?:ООО|АО|ПАО|ЗАО)\s+[A-Za-zА-Яа-яЁё0-9"«» .-]{2,80})/u);
  }

  return undefined;
}

function firstDiscountedRublePrice(value: string): string | undefined {
  const matches = [...value.matchAll(/(\d[\d ]{0,8}\s*₽)(?=-\d+%)/gu)];
  return normalizeSpaces(matches[0]?.[1]);
}

function firstMatch(value: string, pattern: RegExp): string | undefined {
  return normalizeSpaces(value.match(pattern)?.[1]);
}

function normalizeSpaces(value: string | undefined): string | undefined {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

function isPolicyOrOfferRule(ruleId: string): boolean {
  return ruleId.startsWith("PD-") || ruleId === "EC-001" || ruleId === "EC-002";
}

function isInternalContext(value: string): boolean {
  return /^(Derived fact|Derived from|Static extraction processed|Site-level static aggregate|No privacy\/personal-data|A privacy\/personal-data)/i.test(
    value
  );
}

function shortText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const compacted = compact(value, 160);
  return compacted.length > 2 ? compacted : undefined;
}

function cleanEvidenceText(value: string | undefined, sourceUrl?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const withoutInternalLabel = value.replace(
    /^(ТЕКСТ_СОГЛАСИЯ|ЦЕЛИ_ОБРАБОТКИ|КАТЕГОРИИ_ДАННЫХ|СРОКИ_ХРАНЕНИЯ|ПОРЯДОК_ОБРАЩЕНИЙ|Специальные данные|Порядок претензий|Платная услуга|Правила рекомендаций|Русский язык)\s*:\s*/u,
    ""
  );
  if (!sourceUrl || !isHttpUrl(sourceUrl)) {
    return withoutInternalLabel;
  }
  return withoutInternalLabel.replaceAll(sourceUrl, "").replace(/\s+([.,;:])/g, "$1");
}

function uniqueTextParts(values: Array<string | undefined>): string[] {
  const unique = new Map<string, string>();

  for (const value of values) {
    const key = normalizePresentationKey(value ?? "");
    if (key && !unique.has(key)) {
      unique.set(key, value!.trim());
    }
  }

  return [...unique.values()];
}

function normalizePresentationKey(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(", ") || undefined;
  }

  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function compact(value: string, max: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > max ? `${compacted.slice(0, max - 1)}…` : compacted;
}
