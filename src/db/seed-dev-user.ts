import { loadLocalEnv } from "@/config/env";
import { getPool } from "./client";
import { upsertUser } from "./repository";

export const DEVELOPMENT_USER_ID = "00000000-0000-4000-8000-000000000001";

loadLocalEnv();

export async function seedDevelopmentUser() {
  return upsertUser(getPool(), {
    id: DEVELOPMENT_USER_ID,
    email: process.env.DEV_USER_EMAIL ?? "dev@example.test"
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  seedDevelopmentUser()
    .then(async (user) => {
      await getPool().end();
      console.log(`Development user ready: ${user.email}`);
    })
    .catch(async (error) => {
      await getPool().end().catch(() => undefined);
      console.error(error);
      process.exit(1);
    });
}
