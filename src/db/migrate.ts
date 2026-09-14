import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "@/config/env";
import { getPool } from "./client";

loadLocalEnv();

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const migrationsDir = path.join(process.cwd(), "src", "db", "migrations");
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await pool.query(sql);
  }
}

const cliEntryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;

if (import.meta.url === cliEntryUrl) {
  runMigrations()
    .then(async () => {
      await getPool().end();
      console.log("Migrations applied");
    })
    .catch(async (error) => {
      await getPool().end().catch(() => undefined);
      console.error(error);
      process.exit(1);
    });
}
