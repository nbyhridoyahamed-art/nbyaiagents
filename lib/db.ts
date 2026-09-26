import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

export type { Prisma } from "@/lib/generated/prisma/client";

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. See .env.example.");
  const adapter = new PrismaPg({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 10) });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __nbyPrisma?: PrismaClient };

/** Shared Prisma client (one pool per process, reused across hot reloads). */
export const prisma: PrismaClient = globalForPrisma.__nbyPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__nbyPrisma = prisma;

/** Transaction client type, for services that accept either a client or a transaction. */
export type Db = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
