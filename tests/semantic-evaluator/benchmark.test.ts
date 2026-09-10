import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { calculateBenchmarkMetrics, runPilotBenchmark, writeBenchmarkJsonl, type BenchmarkResultRow } from "@/semantic-evaluator/benchmark";
import { buildBenchmarkInput, PILOT_BENCHMARK_CASES, type PilotBenchmarkCase } from "@/semantic-evaluator/benchmark-dataset";
import { FakeSemanticModelProvider } from "@/semantic-evaluator/fake-provider";
import type { SemanticModelRequest } from "@/semantic-evaluator/types";

function semanticResponse(status: "PASS" | "FAIL" | "MANUAL_CHECK", request: SemanticModelRequest) {
  return {
    status,
    confidence: status === "MANUAL_CHECK" ? 0.5 : 0.9,
    reason_code: `${status}_SYNTHETIC`,
    reason: "Synthetic benchmark response.",
    evidence_refs: request.evidence.slice(0, 1).map((evidence) => evidence.ref)
  };
}

describe("pilot semantic benchmark", () => {
  it("contains at least 8 synthetic cases per pilot rule", () => {
    expect(PILOT_BENCHMARK_CASES).toHaveLength(40);
    for (const ruleId of ["PD-008", "PD-013", "PD-014", "PD-015", "PD-016"]) {
      const cases = PILOT_BENCHMARK_CASES.filter((item) => item.ruleId === ruleId);
      expect(cases).toHaveLength(8);
      expect(cases.filter((item) => item.expected === "PASS")).toHaveLength(3);
      expect(cases.filter((item) => item.expected === "FAIL")).toHaveLength(3);
      expect(cases.filter((item) => item.expected === "MANUAL_CHECK")).toHaveLength(2);
    }
  });

  it("does not send expected verdict, case id, or manual rationale to the model request", async () => {
    const testCase = PILOT_BENCHMARK_CASES[0];
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) => semanticResponse("PASS", request));

    await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    const requestText = JSON.stringify(provider.requests[0]);
    expect(requestText).not.toContain(testCase.caseId);
    expect(requestText).not.toContain("expected");
    expect(requestText).not.toContain(testCase.manualRationale);
    expect(requestText).not.toContain("clear_pass");
    expect(requestText).not.toContain("clear_fail");
  });

  it("writes benchmark artifacts without raw evidence or secrets", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-008-SECRET-HYGIENE",
      ruleId: "PD-008",
      expected: "PASS",
      manualRationale: "Synthetic secret hygiene test.",
      evidence: [
        {
          factType: "consent_text",
          excerpt: "synthetic-secret-token should not be written to artifact"
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) => semanticResponse("PASS", request));
    const { results, stabilityRuns } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });
    const artifactDir = path.join(process.cwd(), "tmp", "benchmark-tests");
    const artifactPath = path.join(artifactDir, "artifact.jsonl");
    await mkdir(artifactDir, { recursive: true });

    await writeBenchmarkJsonl(artifactPath, [...results, ...stabilityRuns]);
    const artifact = await readFile(artifactPath, "utf8");

    expect(artifact).toContain(testCase.caseId);
    expect(artifact).not.toContain("synthetic-secret-token");
    expect(artifact).not.toContain("GIGACHAT_AUTH_KEY");
    expect(artifact).not.toContain("access_token");
  });

  it("persists stability run rows in the benchmark artifact", async () => {
    const cases = PILOT_BENCHMARK_CASES.slice(0, 2);
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) => semanticResponse("PASS", request));
    const benchmark = await runPilotBenchmark({ provider, cases, stabilityCaseCount: 2, stabilityRuns: 3 });
    const artifactDir = path.join(process.cwd(), "tmp", "benchmark-tests");
    const artifactPath = path.join(artifactDir, "stability.jsonl");

    await writeBenchmarkJsonl(artifactPath, [...benchmark.results, ...benchmark.stabilityRuns]);
    const artifactRows = (await readFile(artifactPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(benchmark.stabilityRuns).toHaveLength(6);
    expect(artifactRows.filter((row) => row.benchmark_phase === "stability")).toHaveLength(6);
    expect(artifactRows.filter((row) => row.benchmark_phase === "stability").map((row) => row.stability_run)).toEqual([
      1, 2, 3, 1, 2, 3
    ]);
  });

  it("calculates metrics and separates technical NO_EVALUATION from semantic MANUAL_CHECK", () => {
    const rows: BenchmarkResultRow[] = [
      row("a", "PD-008", "PASS", "PASS", 0.9, null),
      row("b", "PD-008", "FAIL", "PASS", 0.8, null),
      row("c", "PD-013", "MANUAL_CHECK", "MANUAL_CHECK", 0.4, null),
      row("d", "PD-013", "MANUAL_CHECK", "NO_EVALUATION", null, "PROVIDER_TIMEOUT")
    ];

    const metrics = calculateBenchmarkMetrics(rows);

    expect(metrics.total_cases).toBe(4);
    expect(metrics.evaluated_cases).toBe(3);
    expect(metrics.technical_no_evaluation).toBe(1);
    expect(metrics.false_pass).toBe(1);
    expect(metrics.false_fail).toBe(0);
    expect(metrics.expected_manual_check_actual.MANUAL_CHECK).toBe(1);
    expect(metrics.expected_manual_check_actual.NO_EVALUATION).toBe(1);
    expect(metrics.confusion_matrix.MANUAL_CHECK.MANUAL_CHECK).toBe(1);
    expect(metrics.confusion_matrix.MANUAL_CHECK.NO_EVALUATION).toBe(1);
  });

  it("builds benchmark inputs without case labels in evidence refs", () => {
    const testCase = PILOT_BENCHMARK_CASES[0];
    const input = buildBenchmarkInput(testCase);

    expect(JSON.stringify(input)).not.toContain(testCase.caseId);
    expect(input.evidence[0].ref).toBe("consent_text:1");
  });
});

function row(
  caseId: string,
  ruleId: string,
  expected: BenchmarkResultRow["expected"],
  actual: BenchmarkResultRow["actual"],
  confidence: number | null,
  technicalErrorCode: string | null
): BenchmarkResultRow {
  return {
    case_id: caseId,
    rule_id: ruleId,
    expected,
    actual,
    confidence,
    reason_code: actual === "NO_EVALUATION" ? null : `${actual}_SYNTHETIC`,
    evidence_refs: actual === "NO_EVALUATION" ? [] : ["consent_text:1"],
    duration_ms: 100,
    technical_error_code: technicalErrorCode,
    schema_failure: null
  };
}
