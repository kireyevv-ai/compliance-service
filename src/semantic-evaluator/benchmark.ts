import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { evaluateSemanticRule } from "./evaluator";
import { buildBenchmarkInput, PILOT_BENCHMARK_CASES, type PilotBenchmarkCase } from "./benchmark-dataset";
import type {
  SemanticEvaluation,
  SemanticEvaluationResult,
  SemanticEvaluationStatus,
  SemanticObservation,
  SemanticModelProvider,
  SemanticSchemaFailureDiagnostic
} from "./types";

export type BenchmarkActualStatus = SemanticEvaluationStatus | "NO_EVALUATION";
export type BenchmarkActualObservation = SemanticObservation | "NO_EVALUATION";

export interface BenchmarkResultRow {
  benchmark_phase?: "main";
  case_id: string;
  rule_id: string;
  expected: SemanticEvaluationStatus;
  expected_observation: SemanticObservation;
  actual: BenchmarkActualStatus;
  semantic_observation: BenchmarkActualObservation;
  confidence: number | null;
  reason_code: string | null;
  evidence_refs: string[];
  duration_ms: number;
  technical_error_code: string | null;
  schema_failure: SemanticSchemaFailureDiagnostic | null;
}

export interface BenchmarkStabilityRunRow extends Omit<BenchmarkResultRow, "benchmark_phase"> {
  benchmark_phase: "stability";
  stability_run: number;
}

export type BenchmarkArtifactRow = BenchmarkResultRow | BenchmarkStabilityRunRow;

export interface BenchmarkMetrics {
  total_cases: number;
  evaluated_cases: number;
  technical_no_evaluation: number;
  observation_accuracy: number;
  observation_confusion_matrix: Record<SemanticObservation, Record<BenchmarkActualObservation, number>>;
  exact_verdict_accuracy: number;
  false_pass: number;
  false_fail: number;
  expected_manual_check_actual: Record<BenchmarkActualStatus, number>;
  latency_by_rule: Record<string, { average_ms: number; median_ms: number }>;
  confidence_distribution: { min: number | null; max: number | null; average: number | null };
  confusion_matrix: Record<SemanticEvaluationStatus, Record<BenchmarkActualStatus, number>>;
}

export interface StabilityResult {
  case_id: string;
  rule_id: string;
  observations: BenchmarkActualObservation[];
  verdicts: BenchmarkActualStatus[];
  observation_stable: boolean;
  stable: boolean;
  confidence_min: number | null;
  confidence_max: number | null;
  confidence_delta: number | null;
}

export interface BenchmarkRunResult {
  results: BenchmarkResultRow[];
  stabilityRuns: BenchmarkStabilityRunRow[];
  metrics: BenchmarkMetrics;
  stability: StabilityResult[];
}

export interface RunBenchmarkOptions {
  provider: SemanticModelProvider;
  cases?: PilotBenchmarkCase[];
  timeoutMs?: number;
  stabilityCaseCount?: number;
  stabilityRuns?: number;
}

const STATUSES: SemanticEvaluationStatus[] = ["PASS", "FAIL", "MANUAL_CHECK"];
const ACTUAL_STATUSES: BenchmarkActualStatus[] = ["PASS", "FAIL", "MANUAL_CHECK", "NO_EVALUATION"];
const OBSERVATIONS: SemanticObservation[] = ["PRESENT", "ABSENT", "AMBIGUOUS"];
const ACTUAL_OBSERVATIONS: BenchmarkActualObservation[] = ["PRESENT", "ABSENT", "AMBIGUOUS", "NO_EVALUATION"];

export async function runPilotBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkRunResult> {
  const cases = options.cases ?? PILOT_BENCHMARK_CASES;
  const results: BenchmarkResultRow[] = [];

  for (const testCase of cases) {
    results.push(await evaluateCase(testCase, options.provider, options.timeoutMs));
  }

  const stabilityCases = cases.slice(0, options.stabilityCaseCount ?? 10);
  const stabilityRuns = options.stabilityRuns ?? 3;
  const stabilityRunRows: BenchmarkStabilityRunRow[] = [];
  const stability: StabilityResult[] = [];
  for (const testCase of stabilityCases) {
    const rows: BenchmarkResultRow[] = [];
    for (let index = 0; index < stabilityRuns; index += 1) {
      const row = await evaluateCase(testCase, options.provider, options.timeoutMs);
      rows.push(row);
      stabilityRunRows.push({ ...row, benchmark_phase: "stability", stability_run: index + 1 });
    }
    stability.push(stabilityFor(testCase, rows));
  }

  return { results, stabilityRuns: stabilityRunRows, metrics: calculateBenchmarkMetrics(results), stability };
}

export async function writeBenchmarkJsonl(filePath: string, rows: BenchmarkArtifactRow[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

export function calculateBenchmarkMetrics(rows: BenchmarkResultRow[]): BenchmarkMetrics {
  const evaluated = rows.filter((row) => row.actual !== "NO_EVALUATION");
  const exact = evaluated.filter((row) => row.actual === row.expected).length;
  const exactObservation = evaluated.filter((row) => row.semantic_observation === row.expected_observation).length;
  const confidences = evaluated.map((row) => row.confidence).filter((value): value is number => typeof value === "number");

  return {
    total_cases: rows.length,
    evaluated_cases: evaluated.length,
    technical_no_evaluation: rows.length - evaluated.length,
    observation_accuracy: evaluated.length > 0 ? exactObservation / evaluated.length : 0,
    observation_confusion_matrix: observationConfusionMatrix(rows),
    exact_verdict_accuracy: evaluated.length > 0 ? exact / evaluated.length : 0,
    false_pass: rows.filter((row) => row.actual === "PASS" && row.expected !== "PASS").length,
    false_fail: rows.filter((row) => row.actual === "FAIL" && row.expected !== "FAIL").length,
    expected_manual_check_actual: countActual(rows.filter((row) => row.expected === "MANUAL_CHECK")),
    latency_by_rule: latencyByRule(rows),
    confidence_distribution: {
      min: confidences.length > 0 ? Math.min(...confidences) : null,
      max: confidences.length > 0 ? Math.max(...confidences) : null,
      average: confidences.length > 0 ? average(confidences) : null
    },
    confusion_matrix: confusionMatrix(rows)
  };
}

async function evaluateCase(
  testCase: PilotBenchmarkCase,
  provider: SemanticModelProvider,
  timeoutMs?: number
): Promise<BenchmarkResultRow> {
  const input = buildBenchmarkInput(testCase);
  const started = performance.now();
  const rawResult = await evaluateSemanticRule(input, { provider, timeoutMs });
  const guarded = applyTruncatedPolicyGuard(rawResult, testCase);
  const duration = Math.round(performance.now() - started);

  return {
    case_id: testCase.caseId,
    rule_id: testCase.ruleId,
    expected: testCase.expected,
    expected_observation: testCase.expectedObservation,
    actual: guarded.status,
    semantic_observation: guarded.status === "NO_EVALUATION" ? "NO_EVALUATION" : guarded.observation,
    confidence: guarded.status === "NO_EVALUATION" ? null : guarded.confidence,
    reason_code: guarded.status === "NO_EVALUATION" ? null : guarded.reasonCode,
    evidence_refs: guarded.status === "NO_EVALUATION" ? [] : guarded.evidenceRefs,
    duration_ms: duration,
    technical_error_code: guarded.status === "NO_EVALUATION" ? guarded.technicalErrorCode : null,
    schema_failure: guarded.status === "NO_EVALUATION" ? guarded.schemaFailure ?? null : null
  };
}

function applyTruncatedPolicyGuard(result: SemanticEvaluationResult, testCase: PilotBenchmarkCase): SemanticEvaluationResult {
  if (
    result.status !== "FAIL" ||
    !testCase.evidence.some((item) => item.factType === "privacy_policy_text" && item.truncated === true)
  ) {
    return result;
  }

  const guarded: SemanticEvaluation = {
    status: "MANUAL_CHECK",
    observation: result.observation,
    confidence: Math.min(result.confidence, 0.5),
    reasonCode: "TRUNCATED_POLICY_REQUIRES_MANUAL_CHECK",
    reason: "Policy evidence was truncated, so benchmark shadow mode cannot produce an absence-based FAIL.",
    evidenceRefs: result.evidenceRefs
  };
  return guarded;
}

function countActual(rows: BenchmarkResultRow[]): Record<BenchmarkActualStatus, number> {
  return Object.fromEntries(ACTUAL_STATUSES.map((status) => [status, rows.filter((row) => row.actual === status).length])) as Record<
    BenchmarkActualStatus,
    number
  >;
}

function countActualObservations(rows: BenchmarkResultRow[]): Record<BenchmarkActualObservation, number> {
  return Object.fromEntries(
    ACTUAL_OBSERVATIONS.map((observation) => [observation, rows.filter((row) => row.semantic_observation === observation).length])
  ) as Record<BenchmarkActualObservation, number>;
}

function confusionMatrix(rows: BenchmarkResultRow[]): Record<SemanticEvaluationStatus, Record<BenchmarkActualStatus, number>> {
  return Object.fromEntries(
    STATUSES.map((expected) => [expected, countActual(rows.filter((row) => row.expected === expected))])
  ) as Record<SemanticEvaluationStatus, Record<BenchmarkActualStatus, number>>;
}

function observationConfusionMatrix(rows: BenchmarkResultRow[]): Record<SemanticObservation, Record<BenchmarkActualObservation, number>> {
  return Object.fromEntries(
    OBSERVATIONS.map((expected) => [expected, countActualObservations(rows.filter((row) => row.expected_observation === expected))])
  ) as Record<SemanticObservation, Record<BenchmarkActualObservation, number>>;
}

function latencyByRule(rows: BenchmarkResultRow[]): Record<string, { average_ms: number; median_ms: number }> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    grouped.set(row.rule_id, [...(grouped.get(row.rule_id) ?? []), row.duration_ms]);
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([ruleId, durations]) => [
      ruleId,
      { average_ms: Math.round(average(durations)), median_ms: median(durations) }
    ])
  );
}

function stabilityFor(testCase: PilotBenchmarkCase, rows: BenchmarkResultRow[]): StabilityResult {
  const verdicts = rows.map((row) => row.actual);
  const observations = rows.map((row) => row.semantic_observation);
  const confidences = rows.map((row) => row.confidence).filter((value): value is number => typeof value === "number");
  return {
    case_id: testCase.caseId,
    rule_id: testCase.ruleId,
    observations,
    verdicts,
    observation_stable: new Set(observations).size === 1,
    stable: new Set(verdicts).size === 1,
    confidence_min: confidences.length > 0 ? Math.min(...confidences) : null,
    confidence_max: confidences.length > 0 ? Math.max(...confidences) : null,
    confidence_delta: confidences.length > 0 ? Math.max(...confidences) - Math.min(...confidences) : null
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}
