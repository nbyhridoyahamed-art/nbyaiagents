import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Object storage abstraction for knowledge documents, avatars, logos and
 * reports. Files are private: they're only served through the authenticated,
 * signed download route (app/api/files/[id]). Add an S3-compatible driver by
 * implementing this interface.
 */
export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

function localRoot() {
  return path.resolve(env().STORAGE_LOCAL_DIR);
}

function safePath(key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  const full = path.resolve(localRoot(), key);
  if (!full.startsWith(localRoot() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

const localDriver: StorageDriver = {
  async put(key, data) {
    const file = safePath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  },
  async get(key) {
    return fs.readFile(safePath(key));
  },
  async delete(key) {
    await fs.rm(safePath(key), { force: true });
  },
};

export function storage(): StorageDriver {
  switch (env().STORAGE_DRIVER) {
    case "local":
    default:
      return localDriver;
  }
}

export function storageKey(orgId: string, purpose: string, fileId: string, fileName: string) {
  const clean = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-80) || "file";
  return `${orgId}/${purpose}/${fileId}-${clean}`;
}
