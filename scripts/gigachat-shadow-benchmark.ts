import path from "node:path";
import { loadLocalEnv } from "@/config/env";
import { GigaChatSemanticModelProvider } from "@/semantic-evaluator/providers/gigachat";
import { PILOT_BENCHMARK_CASES } from "@/semantic-evaluator/benchmark-dataset";
import { runPilotBenchmark, writeBenchmarkJsonl } from "@/semantic-evaluator/benchmark";

const MODEL = "GigaChat-3-Pro";
const DEFAULT_TIMEOUT_MS = 60_000;
const EVALUATOR_TIMEOUT_BUFFER_MS = 5_000;

async function main() {
  loadLocalEnv();

  if (!process.env.GIGACHAT_AUTH_KEY?.trim()) {
    throw new Error("GIGACHAT_AUTH_KEY is not configured");
  }

  const providerTimeoutMs = numberFromEnv("SEMANTIC_LLM_TIMEOUT_MS", numberFromEnv("GIGACHAT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS));
  const maxRetries = numberFromEnv("GIGACHAT_MAX_RETRIES", 1);
  const evaluatorTimeoutMs = providerTimeoutMs * (maxRetries + 1) + EVALUATOR_TIMEOUT_BUFFER_MS;
  const provider = new GigaChatSemanticModelProvider({
    model: MODEL,
    timeoutMs: providerTimeoutMs,
    maxRetries
  });

  const benchmark = await runPilotBenchmark({
    provider,
    cases: PILOT_BENCHMARK_CASES,
    timeoutMs: evaluatorTimeoutMs,
    stabilityCaseCount: 10,
    stabilityRuns: 3
  });
  const artifactPath = path.join("tmp", `gigachat-shadow-benchmark-${timestamp()}.jsonl`);
  await writeBenchmarkJsonl(artifactPath, benchmark.results);

  console.log(
    JSON.stringify(
      {
        model: MODEL,
        artifact_path: artifactPath,
        case_count: PILOT_BENCHMARK_CASES.length,
        metrics: benchmark.metrics,
        stability: {
          total_cases: benchmark.stability.length,
          stable_cases: benchmark.stability.filter((item) => item.stable).length,
          unstable_cases: benchmark.stability.filter((item) => !item.stable)
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`GigaChat shadow benchmark failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});

function numberFromEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
