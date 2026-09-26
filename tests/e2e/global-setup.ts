import { execSync } from "node:child_process";
import fs from "node:fs";
import pg from "pg";
import { E2E } from "./env";

/** Creates (once) and resets the end-to-end database, then applies migrations. */
export default async function globalSetup() {
  const admin = new URL(E2E.databaseUrl);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'nby_e2e'");
  if (!exists.rowCount) await client.query(`CREATE DATABASE nby_e2e ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  await client.end();

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: E2E.databaseUrl } });

  const db = new pg.Client({ connectionString: E2E.databaseUrl });
  await db.connect();
  const { rows } = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
  if (rows.length) await db.query(`TRUNCATE ${rows.map((r) => `"public"."${r.tablename}"`).join(", ")} CASCADE`);
  await db.end();

  fs.rmSync(E2E.mailDir, { recursive: true, force: true });
  fs.mkdirSync(E2E.mailDir, { recursive: true });
}
