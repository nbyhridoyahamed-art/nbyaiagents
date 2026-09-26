import crypto from "node:crypto";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { resolveProviderCredentials } from "@/server/services/ai-providers";

/**
 * Embedding service. Uses a provider embedding model when one is configured
 * (OpenAI → Google), otherwise a local lexical embedder (feature hashing) that
 * works offline. Every vector is tagged with the model that produced it; search
 * only ever compares vectors from the same model.
 */

export const LOCAL_EMBEDDING_MODEL = "local-hash-v1";
const LOCAL_DIMS = 512;

export interface Embedding {
  vector: number[];
  model: string;
}

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have i if in into is it its of on or our so that the their them then there these they this to was we were what when which who will with you your".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Very small suffix stemmer — good enough to match "refunds"/"refund", "shipping"/"ship". */
function stem(t: string): string {
  if (t.length <= 4) return t;
  for (const suffix of ["ings", "ing", "edly", "ed", "ies", "es", "s", "ly"]) {
    if (t.endsWith(suffix) && t.length - suffix.length >= 3) return suffix === "ies" ? t.slice(0, -3) + "y" : t.slice(0, -suffix.length);
  }
  return t;
}

function hashIndex(feature: string): { index: number; sign: number } {
  const h = crypto.createHash("md5").update(feature).digest();
  return { index: h.readUInt32LE(0) % LOCAL_DIMS, sign: h[4] & 1 ? 1 : -1 };
}

/** Deterministic lexical embedding: hashed unigram + bigram TF, sublinear, L2-normalised. */
export function localEmbed(text: string): number[] {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1);
    if (i + 1 < tokens.length) {
      const bigram = `${tokens[i]}_${tokens[i + 1]}`;
      counts.set(bigram, (counts.get(bigram) ?? 0) + 0.5);
    }
  }
  const vec = new Array<number>(LOCAL_DIMS).fill(0);
  for (const [feature, count] of counts) {
    const { index, sign } = hashIndex(feature);
    vec[index] += sign * (1 + Math.log(count));
  }
  return normalize(vec);
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Which embedding model an organization indexes with right now. */
export async function currentEmbeddingModel(orgId: string): Promise<string> {
  if ((await resolveProviderCredentials(orgId, "OPENAI")).source !== "none") return "openai:text-embedding-3-small";
  if ((await resolveProviderCredentials(orgId, "GOOGLE")).source !== "none") return "google:text-embedding-004";
  return LOCAL_EMBEDDING_MODEL;
}

export async function embedTexts(orgId: string, texts: string[], model?: string): Promise<Embedding[]> {
  const m = model ?? (await currentEmbeddingModel(orgId));
  if (texts.length === 0) return [];
  if (m === LOCAL_EMBEDDING_MODEL) return texts.map((t) => ({ vector: localEmbed(t), model: m }));

  if (m.startsWith("openai:")) {
    const creds = await resolveProviderCredentials(orgId, "OPENAI");
    if (!creds.apiKey) return texts.map((t) => ({ vector: localEmbed(t), model: LOCAL_EMBEDDING_MODEL }));
    const client = new OpenAI({ apiKey: creds.apiKey });
    const out: Embedding[] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 24000));
      const res = await client.embeddings.create({ model: m.slice("openai:".length), input: batch });
      for (const d of res.data) out.push({ vector: d.embedding, model: m });
    }
    return out;
  }

  if (m.startsWith("google:")) {
    const creds = await resolveProviderCredentials(orgId, "GOOGLE");
    if (!creds.apiKey) return texts.map((t) => ({ vector: localEmbed(t), model: LOCAL_EMBEDDING_MODEL }));
    const client = new GoogleGenAI({ apiKey: creds.apiKey });
    const out: Embedding[] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const batch = texts.slice(i, i + 64).map((t) => t.slice(0, 8000));
      const res = await client.models.embedContent({ model: m.slice("google:".length), contents: batch });
      for (const e of res.embeddings ?? []) out.push({ vector: e.values ?? [], model: m });
    }
    return out;
  }

  return texts.map((t) => ({ vector: localEmbed(t), model: LOCAL_EMBEDDING_MODEL }));
}
