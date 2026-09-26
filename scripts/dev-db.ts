/**
 * Embedded PostgreSQL for local development.
 *
 * Starts a real PostgreSQL server from the `embedded-postgres` npm binaries so the
 * app can run without a system-wide Postgres install. Production deployments should
 * point DATABASE_URL at a managed PostgreSQL instead.
 *
 *   npm run db:start   # start (initialises the cluster on first run)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const dataDir = path.resolve(".data/postgres");
const databases = ["nby", "nby_test"];

const recentLog: string[] = [];

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
    authMethod: "scram-sha-256",
    // Force UTF-8: on Windows initdb otherwise inherits the OS code page (e.g. WIN1252).
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    // Keep the server log quiet, but remember it so a failed start can explain itself.
    onLog: (m) => void recentLog.push(String(m).trim()),
    onError: (err) => console.error("[postgres]", err),
  });

  if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log(`[db] initialising cluster in ${dataDir}`);
    await pg.initialise();
  }

  // A crashed previous run can leave a stale lock file behind. Only remove it
  // when the process it names is gone — never pull the lock from a live server.
  const pidFile = path.join(dataDir, "postmaster.pid");
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8").split(/\r?\n/)[0]);
    if (pid && isAlive(pid)) {
      console.error(`[db] PostgreSQL is already running for this project (pid ${pid}). Stop it first, or just use it.`);
      process.exit(1);
    }
    console.warn("[db] removing stale postmaster.pid");
    fs.rmSync(pidFile);
  }

  try {
    await pg.start();
  } catch (err) {
    console.error("[db] PostgreSQL failed to start:\n" + recentLog.slice(-8).join("\n"));
    if (recentLog.some((l) => l.includes("shared memory block is still in use"))) {
      console.error("[db] An old postgres.exe from this project is still running. End it in Task Manager (its path is under node_modules/@embedded-postgres) and retry.");
    }
    throw err;
  }
  const client = pg.getPgClient();
  await client.connect();
  for (const name of databases) {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
      console.log(`[db] created database ${name}`);
    }
  }
  await client.end();
  console.log(`[db] PostgreSQL ready on postgresql://postgres:***@localhost:${port}/nby`);

  const shutdown = async () => {
    console.log("\n[db] stopping PostgreSQL…");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[db] failed to start", err ?? "");
  process.exit(1);
});
