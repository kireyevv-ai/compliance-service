import { randomUUID } from "node:crypto";
import { loadLocalEnv } from "@/config/env";
import { getPool } from "@/db/client";
import {
  claimQueuedScanById,
  completeScan,
  createFact,
  createQueuedScan,
  createSite,
  upsertUser
} from "@/db/repository";
import type { SiteType } from "@/db/schema";

loadLocalEnv();

type SmokeScenario = {
  key: "A" | "B" | "C" | "D";
  siteType: SiteType;
  facts: Array<{ factType: string; pageUrl?: string; value?: Record<string, unknown> }>;
};

const scenarios: SmokeScenario[] = [
  {
    key: "A",
    siteType: "B2B",
    facts: [
      {
        factType: "personal_data_collection_found",
        pageUrl: "https://owner-ui-smoke.example.test/contacts",
        value: {
          found: true,
          contextKey: "form-consultation",
          formLabel: "Заказать консультацию",
          pageTitle: "Контакты",
          fields: ["name", "phone", "email"]
        }
      },
      {
        factType: "personal_data_collection_found",
        pageUrl: "https://owner-ui-smoke.example.test/support",
        value: {
          found: true,
          contextKey: "form-callback",
          pageTitle: "Поддержка",
          fields: ["name", "phone"]
        }
      },
      { factType: "marketing_subscription_detected", value: { found: true, text: "Подписаться на новости" } }
    ]
  },
  {
    key: "B",
    siteType: "B2B",
    facts: [{ factType: "auth_ui_static_signal", value: { found: true, text: "Войти в личный кабинет" } }]
  },
  {
    key: "C",
    siteType: "B2B",
    facts: [
      {
        factType: "marketing_subscription_detected",
        value: { found: true, text: "Подписаться на акции и предложения" }
      }
    ]
  },
  {
    key: "D",
    siteType: "OTHER",
    facts: []
  }
];

async function main() {
  assertLocalSmokeEnvironment();
  const pool = getPool();

  try {
    const urls: Record<SmokeScenario["key"], string> = { A: "", B: "", C: "", D: "" };

    for (const scenario of scenarios) {
      const scanId = await createScenario(pool, scenario);
      urls[scenario.key] = `${localAppOrigin()}/owner-context/${scanId}`;
    }

    console.log(`Scenario A URL: ${urls.A}`);
    console.log(`Scenario B URL: ${urls.B}`);
    console.log(`Scenario C URL: ${urls.C}`);
    console.log(`Scenario D URL: ${urls.D}`);
  } finally {
    await pool.end();
  }
}

async function createScenario(
  db: ReturnType<typeof getPool>,
  scenario: SmokeScenario
): Promise<string> {
  const suffix = randomUUID();
  const user = await upsertUser(db, { email: `owner-ui-smoke-${scenario.key.toLowerCase()}-${suffix}@example.test` });
  const site = await createSite(db, {
    userId: user.id,
    url: `https://owner-ui-smoke-${scenario.key.toLowerCase()}-${suffix}.example.test/`,
    normalizedDomain: `owner-ui-smoke-${scenario.key.toLowerCase()}-${suffix}.example.test`
  });
  const queuedScan = await createQueuedScan(db, {
    siteId: site.id,
    siteType: scenario.siteType,
    scannerVersion: "owner-context-ui-smoke"
  });
  const runningScan = await claimQueuedScanById(db, queuedScan.id);

  if (!runningScan) {
    throw new Error(`Cannot mark smoke scan ${queuedScan.id} as running`);
  }

  for (const [index, item] of scenario.facts.entries()) {
    await createFact(db, {
      scanId: runningScan.id,
      pageUrl: item.pageUrl ?? `https://owner-ui-smoke.example.test/${scenario.key.toLowerCase()}/${index}`,
      factType: item.factType,
      value: item.value ?? { found: true }
    });
  }

  await completeScan(db, runningScan.id);
  return runningScan.id;
}

function assertLocalSmokeEnvironment(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Owner context UI smoke seed must not run with NODE_ENV=production");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const url = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Owner context UI smoke seed requires a local database host");
  }
}

function localAppOrigin(): string {
  const port = process.env.PORT?.trim() || "3000";
  return `http://localhost:${port}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Owner context UI smoke seed failed");
  process.exit(1);
});
