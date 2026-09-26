import path from "node:path";

/** End-to-end tests run against their own database, build and mailbox — never the dev data. */
function databaseUrl() {
  const base = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/nby?schema=public";
  const u = new URL(base);
  u.pathname = "/nby_e2e";
  return u.toString();
}

export const E2E = {
  port: 3100,
  baseURL: "http://localhost:3100",
  databaseUrl: databaseUrl(),
  mailDir: path.resolve(".data/e2e-mail"),
  distDir: ".next-e2e",
};
