import { loadLocalEnv } from "@/config/env";
import { GigaChatSemanticModelProvider } from "@/semantic-evaluator/providers/gigachat";

async function main() {
  loadLocalEnv();

  if (!process.env.GIGACHAT_AUTH_KEY?.trim()) {
    console.log("GIGACHAT_AUTH_KEY is not configured; skipping real GigaChat models smoke.");
    return;
  }

  const provider = new GigaChatSemanticModelProvider();
  const models = await provider.listModels();

  console.log("Available GigaChat models:");
  for (const model of models) {
    console.log(model.id);
  }
}

main().catch((error) => {
  console.error(`GigaChat models smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
