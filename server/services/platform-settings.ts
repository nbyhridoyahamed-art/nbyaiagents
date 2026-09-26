import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";

/**
 * Platform-wide switches set by platform admins. Read on the hot path, so values are
 * cached briefly in-process.
 */

type Key = "integrations.disabled" | "templates.disabled";
const TTL_MS = 10_000;
const cache = new Map<Key, { value: string[]; at: number }>();

export async function getDisabled(key: Key): Promise<string[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  const value = Array.isArray(row?.value) ? (row!.value as unknown[]).filter((v): v is string => typeof v === "string") : [];
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setDisabled(key: Key, values: string[], updatedById: string) {
  const unique = [...new Set(values)].slice(0, 200);
  await prisma.platformSetting.upsert({ where: { key }, create: { key, value: unique, updatedById }, update: { value: unique, updatedById } });
  cache.delete(key);
  return unique;
}

export async function assertIntegrationEnabled(integrationKey: string) {
  if ((await getDisabled("integrations.disabled")).includes(integrationKey)) {
    throw new AppError("FORBIDDEN", "This integration has been turned off by the platform administrator.");
  }
}

export async function assertTemplateEnabled(templateKey: string) {
  if ((await getDisabled("templates.disabled")).includes(templateKey)) {
    throw new AppError("FORBIDDEN", "This template has been turned off by the platform administrator.");
  }
}
