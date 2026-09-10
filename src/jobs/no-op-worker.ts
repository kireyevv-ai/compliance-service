import { getPool } from "@/db/client";
import { runNoOpScanLifecycle } from "./scan-queue";

async function main(): Promise<void> {
  const result = await runNoOpScanLifecycle(getPool(), {
    failWithReason: process.env.NO_OP_SCAN_FAIL_REASON
  });

  if (!result) {
    console.log("No queued scans");
    return;
  }

  console.log(`Scan ${result.id} finished with status ${result.status}`);
}

main()
  .then(async () => {
    await getPool().end();
  })
  .catch(async (error) => {
    await getPool().end().catch(() => undefined);
    console.error(error);
    process.exit(1);
  });
