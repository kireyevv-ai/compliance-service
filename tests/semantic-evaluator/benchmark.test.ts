import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { calculateBenchmarkMetrics, runPilotBenchmark, writeBenchmarkJsonl, type BenchmarkResultRow } from "@/semantic-evaluator/benchmark";
import { buildBenchmarkInput, PILOT_BENCHMARK_CASES, type PilotBenchmarkCase } from "@/semantic-evaluator/benchmark-dataset";
import { FakeSemanticModelProvider } from "@/semantic-evaluator/fake-provider";
import type { SemanticModelRequest, SemanticObservation } from "@/semantic-evaluator/types";

function semanticResponse(observation: SemanticObservation, request: SemanticModelRequest) {
  return {
    observation,
    confidence: observation === "AMBIGUOUS" ? 0.5 : 0.9,
    reason_code: `${observation}_SYNTHETIC`,
    reason: "Synthetic benchmark response.",
    evidence_refs: request.evidence.slice(0, 1).map((evidence) => evidence.ref)
  };
}

describe("pilot semantic benchmark", () => {
  it("contains at least 8 synthetic cases per pilot rule", () => {
    expect(PILOT_BENCHMARK_CASES).toHaveLength(144);
    for (const ruleId of [
      "PD-005",
      "PD-008",
      "PD-009",
      "PD-010",
      "CK-001",
      "CK-004",
      "PD-013",
      "PD-014",
      "PD-015",
      "PD-016",
      "PD-017",
      "PD-018",
      "PD-019",
      "PD-024",
      "EC-010",
      "EC-012",
      "REC-003",
      "LANG-001"
    ]) {
      const cases = PILOT_BENCHMARK_CASES.filter((item) => item.ruleId === ruleId);
      expect(cases).toHaveLength(8);
      expect(cases.filter((item) => item.expected === "PASS").length).toBeGreaterThanOrEqual(ruleId === "PD-024" ? 2 : 3);
      expect(cases.filter((item) => item.expected === "FAIL")).toHaveLength(ruleId === "PD-024" ? 0 : 3);
      expect(cases.filter((item) => item.expected === "MANUAL_CHECK").length).toBeGreaterThanOrEqual(1);
      expect(cases.every((item) => ["PRESENT", "ABSENT", "AMBIGUOUS"].includes(item.expectedObservation))).toBe(true);
    }
  });

  it("does not send expected verdict, case id, or manual rationale to the model request", async () => {
    const testCase = PILOT_BENCHMARK_CASES[0];
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) => semanticResponse("PRESENT", request));

    await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    const requestText = JSON.stringify(provider.requests[0]);
    expect(requestText).not.toContain(testCase.caseId);
    expect(requestText).not.toContain("expected");
    expect(requestText).not.toContain("expectedObservation");
    expect(requestText).not.toContain("expected_observation");
    expect(requestText).not.toContain(testCase.manualRationale);
    expect(requestText).not.toContain("clear_pass");
    expect(requestText).not.toContain("clear_fail");
    expect(requestText).not.toContain("Return PASS");
    expect(requestText).not.toContain("Return FAIL");
    expect(requestText).not.toContain("Return MANUAL_CHECK");
  });

  it("sends completeness metadata to the model request", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-013-COMPLETE-MISSING",
      ruleId: "PD-013",
      expected: "FAIL",
      expectedObservation: "ABSENT",
      manualRationale: "Complete synthetic policy omits purposes.",
      evidence: [
        {
          factType: "privacy_policy_text",
          excerpt: "Полный текст политики: оператор защищает данные.",
          completeness: "COMPLETE"
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) => semanticResponse("ABSENT", request));

    await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(provider.requests[0].evidence[0]).toMatchObject({
      completeness: "COMPLETE"
    });
  });

  it("allows COMPLETE evidence with a missing required element to produce FAIL", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-013-COMPLETE-ABSENCE",
      ruleId: "PD-013",
      expected: "FAIL",
      expectedObservation: "ABSENT",
      manualRationale: "Complete synthetic policy omits purposes.",
      evidence: [
        {
          factType: "privacy_policy_text",
          excerpt: "Полный текст политики: оператор защищает данные.",
          completeness: "COMPLETE"
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse("ABSENT", request)
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0]).toMatchObject({ expected: "FAIL", actual: "FAIL" });
    expect(results[0]).toMatchObject({ expected_observation: "ABSENT", semantic_observation: "ABSENT" });
  });

  it("maps PARTIAL absence to MANUAL_CHECK", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-013-PARTIAL-ABSENCE",
      ruleId: "PD-013",
      expected: "MANUAL_CHECK",
      expectedObservation: "ABSENT",
      manualRationale: "Partial excerpt cannot prove absence.",
      evidence: [
        {
          factType: "privacy_policy_text",
          excerpt: "Оператор защищает данные.",
          completeness: "PARTIAL"
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse("ABSENT", request)
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0].actual).toBe("MANUAL_CHECK");
    expect(results[0].semantic_observation).toBe("ABSENT");
  });

  it("does not treat TRUNCATED reference-only text as PASS", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-016-TRUNCATED-REFERENCE",
      ruleId: "PD-016",
      expected: "MANUAL_CHECK",
      expectedObservation: "ABSENT",
      manualRationale: "Reference-only truncated evidence does not show the procedure.",
      evidence: [
        {
          factType: "privacy_policy_text",
          excerpt: "Порядок направления запросов субъектов персональных данных приведен далее.",
          completeness: "TRUNCATED",
          truncated: true
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) => {
      const text = request.evidence[0].excerpt;
      return semanticResponse(text.includes("приведен далее") ? "PRESENT" : "ABSENT", request);
    });

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0].actual).toBe("MANUAL_CHECK");
    expect(results[0].semantic_observation).toBe("PRESENT");
  });

  it("allows explicit positive evidence to PASS even when evidence is PARTIAL", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-016-PARTIAL-POSITIVE",
      ruleId: "PD-016",
      expected: "PASS",
      expectedObservation: "PRESENT",
      manualRationale: "Shown excerpt itself contains the request path.",
      evidence: [
        {
          factType: "privacy_policy_text",
          excerpt: "Запрос на удаление данных можно направить на privacy@example.test.",
          completeness: "PARTIAL"
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse(request.evidence[0].excerpt.includes("privacy@example.test") ? "PRESENT" : "AMBIGUOUS", request)
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0].actual).toBe("PASS");
  });

  it("keeps a generic PD-013 site-interaction purpose from being confident PRESENT", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-013-GENERIC-PURPOSE-REGRESSION",
      ruleId: "PD-013",
      expected: "MANUAL_CHECK",
      expectedObservation: "AMBIGUOUS",
      manualRationale: "Generic site-interaction wording is purpose-like but not concrete.",
      evidence: [
        {
          factType: "privacy_policy_text",
          excerpt: "Информация используется в рамках взаимодействия с сайтом.",
          completeness: "UNKNOWN"
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse(request.criterion.includes("too broad") ? "AMBIGUOUS" : "PRESENT", request)
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0]).toMatchObject({ semantic_observation: "AMBIGUOUS", actual: "MANUAL_CHECK" });
  });

  it("keeps a concrete PD-013 order and feedback purpose as PRESENT", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-013-CONCRETE-PURPOSE-REGRESSION",
      ruleId: "PD-013",
      expected: "PASS",
      expectedObservation: "PRESENT",
      manualRationale: "Concrete order processing and feedback purposes are present.",
      evidence: [
        {
          factType: "privacy_policy_text",
          excerpt: "Данные используются для обработки заказа и обратной связи с пользователем.",
          completeness: "UNKNOWN"
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse(request.criterion.includes("order processing") ? "PRESENT" : "AMBIGUOUS", request)
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0]).toMatchObject({ semantic_observation: "PRESENT", actual: "PASS" });
  });

  it("keeps generic PD-014 user-provided information from being confident PRESENT", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-014-GENERIC-CATEGORIES-REGRESSION",
      ruleId: "PD-014",
      expected: "MANUAL_CHECK",
      expectedObservation: "AMBIGUOUS",
      manualRationale: "Generic user-provided information does not identify data categories clearly.",
      evidence: [
        {
          factType: "privacy_policy_text",
          excerpt: "Обрабатываются сведения, предоставленные пользователем при использовании сайта.",
          completeness: "UNKNOWN"
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse(request.criterion.includes("information provided by the user") ? "AMBIGUOUS" : "PRESENT", request)
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0]).toMatchObject({ semantic_observation: "AMBIGUOUS", actual: "MANUAL_CHECK" });
  });

  it("keeps concrete PD-014 name, phone, and email categories as PRESENT", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-014-CONCRETE-CATEGORIES-REGRESSION",
      ruleId: "PD-014",
      expected: "PASS",
      expectedObservation: "PRESENT",
      manualRationale: "Concrete categories are named.",
      evidence: [
        {
          factType: "privacy_policy_text",
          excerpt: "Оператор обрабатывает имя, телефон и адрес электронной почты пользователя.",
          completeness: "UNKNOWN"
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse(request.criterion.includes("name/full name") ? "PRESENT" : "AMBIGUOUS", request)
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0]).toMatchObject({ semantic_observation: "PRESENT", actual: "PASS" });
  });

  it("keeps PD-017 missing date of birth as FAIL with set-inclusion criterion", async () => {
    const testCase = PILOT_BENCHMARK_CASES.find((item) => item.caseId === "PD-017-F01")!;
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse(
        request.criterion.includes("EVERY material personal-data category") &&
          request.criterion.includes("date of birth") &&
          request.criterion.includes("-> ABSENT")
          ? "ABSENT"
          : "PRESENT",
        request
      )
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0]).toMatchObject({ case_id: "PD-017-F01", actual: "FAIL", semantic_observation: "ABSENT" });
  });

  it("keeps PD-017 missing delivery address as FAIL with explicit example guidance", async () => {
    const testCase = PILOT_BENCHMARK_CASES.find((item) => item.caseId === "PD-017-F02")!;
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse(
        request.criterion.includes("delivery address") && request.criterion.includes("policy lists only name and phone number")
          ? "ABSENT"
          : "PRESENT",
        request
      )
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0]).toMatchObject({ case_id: "PD-017-F02", actual: "FAIL", semantic_observation: "ABSENT" });
  });

  it("keeps PD-018 payment category disclosure as PASS without requiring provider brand", async () => {
    const testCase = PILOT_BENCHMARK_CASES.find((item) => item.caseId === "PD-018-P03")!;
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse(
        request.criterion.includes("Provider brand-name matching is not required") &&
          request.criterion.includes("payment operator -> PRESENT")
          ? "PRESENT"
          : "ABSENT",
        request
      )
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0]).toMatchObject({ case_id: "PD-018-P03", actual: "PASS", semantic_observation: "PRESENT" });
  });

  it("keeps PD-019 UNKNOWN service relevance as MANUAL_CHECK even when the provider returns PRESENT", async () => {
    const testCase = PILOT_BENCHMARK_CASES.find((item) => item.caseId === "PD-019-M01")!;
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) =>
      semanticResponse("PRESENT", request)
    );

    const { results } = await runPilotBenchmark({ provider, cases: [testCase], stabilityCaseCount: 0 });

    expect(results[0]).toMatchObject({ case_id: "PD-019-M01", actual: "MANUAL_CHECK", semantic_observation: "PRESENT" });
  });

  it("writes benchmark artifacts without raw evidence or secrets", async () => {
    const testCase: PilotBenchmarkCase = {
      caseId: "PD-008-SECRET-HYGIENE",
      ruleId: "PD-008",
      expected: "PASS",
      expectedObservation: "PRESENT",
      manualRationale: "Synthetic secret hygiene test.",
      evidence: [
        {
          factType: "consent_text",
          excerpt: "synthetic-secret-token should not be written to artifact",
          completeness: "PARTIAL"
        }
      ]
    };
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) => semanticResponse("PRESENT", request));
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
    const provider = new FakeSemanticModelProvider((request: SemanticModelRequest) => semanticResponse("PRESENT", request));
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
    expect(metrics.observation_accuracy).toBeCloseTo(2 / 3);
    expect(metrics.observation_confusion_matrix.ABSENT.PRESENT).toBe(1);
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
    expected_observation: expected === "PASS" ? "PRESENT" : expected === "FAIL" ? "ABSENT" : "AMBIGUOUS",
    actual,
    semantic_observation: actual === "NO_EVALUATION" ? "NO_EVALUATION" : actual === "PASS" ? "PRESENT" : actual === "FAIL" ? "ABSENT" : "AMBIGUOUS",
    confidence,
    reason_code: actual === "NO_EVALUATION" ? null : `${actual}_SYNTHETIC`,
    evidence_refs: actual === "NO_EVALUATION" ? [] : ["consent_text:1"],
    duration_ms: 100,
    technical_error_code: technicalErrorCode,
    schema_failure: null
  };
}
