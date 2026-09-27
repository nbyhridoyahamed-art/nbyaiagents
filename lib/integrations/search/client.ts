import { AppError } from "@/lib/errors";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

async function tavilySearch(apiKey: string, query: string, opts: { maxResults?: number; includeAnswer?: boolean } = {}): Promise<{ results: TavilyResult[]; answer?: string }> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: opts.maxResults ?? 5, include_answer: opts.includeAnswer ?? false, search_depth: "basic" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError("INTEGRATION_ERROR", `Tavily API returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as { results: TavilyResult[]; answer?: string };
}

export async function webSearch(apiKey: string, query: string): Promise<TavilyResult[]> {
  const { results } = await tavilySearch(apiKey, query, { maxResults: 5 });
  return results;
}

export async function companyProfile(apiKey: string, company: string): Promise<{ summary: string; sources: TavilyResult[] }> {
  const { answer, results } = await tavilySearch(apiKey, `${company} company overview: industry, size, headquarters, what they do`, { maxResults: 3, includeAnswer: true });
  return { summary: answer ?? "No summary available.", sources: results };
}
