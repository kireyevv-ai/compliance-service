import { getPool } from "@/db/client";
import { loadLocalEnv } from "@/config/env";
import { runScanWorker } from "./worker-loop";

loadLocalEnv();

const idleDelayMs = Number(process.env.SCAN_WORKER_IDLE_DELAY_MS ?? 2_000);
const staleRunningThresholdMs = Number(process.env.SCAN_STALE_RUNNING_THRESHOLD_MS ?? 30 * 60_000);

runScanWorker({
  db: getPool(),
  idleDelayMs,
  staleRunningThresholdMs
})
  .then(async () => {
    await getPool().end();
  })
  .catch(async (error) => {
    await getPool().end().catch(() => undefined);
    console.error(error instanceof Error ? error.message : "Worker failed");
    process.exit(1);
  });
