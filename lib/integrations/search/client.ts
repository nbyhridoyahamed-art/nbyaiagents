import { AppError } from "@/lib/errors";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

// Tavily documents the bearer header; the body field is kept for older key/API versions.
function tavilyRequest(apiKey: string, payload: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ api_key: apiKey, ...payload }),
  };
}

async function tavilySearch(apiKey: string, query: string, opts: { maxResults?: number; includeAnswer?: boolean } = {}): Promise<{ results: TavilyResult[]; answer?: string }> {
  const res = await fetch(TAVILY_SEARCH_URL, tavilyRequest(apiKey, { query, max_results: opts.maxResults ?? 5, include_answer: opts.includeAnswer ?? false, search_depth: "basic" }));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError("INTEGRATION_ERROR", `Tavily API returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as { results: TavilyResult[]; answer?: string };
}

/**
 * Checks a Tavily API key with one minimal search (about one credit). Returns "rejected" only when
 * Tavily says the key is wrong; any other failure throws so a Tavily outage isn't reported as a bad key.
 */
export async function verifyApiKey(apiKey: string): Promise<"ok" | "rejected"> {
  const res = await fetch(TAVILY_SEARCH_URL, { ...tavilyRequest(apiKey, { query: "connection test", max_results: 1, search_depth: "basic" }), signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) return "rejected";
  if (!res.ok) throw new AppError("INTEGRATION_ERROR", `Tavily returned HTTP ${res.status}. Try again in a minute.`);
  return "ok";
}

export async function webSearch(apiKey: string, query: string): Promise<TavilyResult[]> {
  const { results } = await tavilySearch(apiKey, query, { maxResults: 5 });
  return results;
}

export async function companyProfile(apiKey: string, company: string): Promise<{ summary: string; sources: TavilyResult[] }> {
  const { answer, results } = await tavilySearch(apiKey, `${company} company overview: industry, size, headquarters, what they do`, { maxResults: 3, includeAnswer: true });
  return { summary: answer ?? "No summary available.", sources: results };
}
