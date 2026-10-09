import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyApiKey } from "@/lib/integrations/search/client";
import { SEARCH_TOOLS, resolveApiKey } from "@/lib/integrations/search/tools";
import type { ToolExecutionContext } from "@/lib/tools/types";

afterEach(() => vi.restoreAllMocks());

const ctx = (secret: string | null): ToolExecutionContext => ({ secret }) as ToolExecutionContext;
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe("Web Search key resolution", () => {
  it("uses the company's own key from the Integrations page", () => {
    expect(resolveApiKey(ctx("tvly-company-key-123456"))).toBe("tvly-company-key-123456");
  });

  it("says how to fix it when no key exists anywhere", () => {
    expect(() => resolveApiKey(ctx(null))).toThrow(/Integrations page/);
  });

  it("sends the company key to Tavily when a tool runs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, { results: [{ title: "t", url: "https://example.com", content: "c" }] }));
    const search = SEARCH_TOOLS.find((t) => t.key === "web_search.search")!;
    await search.execute({ query: "joyroom bangladesh" }, ctx("tvly-company-key-123456"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.tavily.com/search");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tvly-company-key-123456");
  });
});

describe("verifyApiKey", () => {
  it("accepts a key Tavily accepts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, { results: [] }));
    expect(await verifyApiKey("tvly-good-key-1234567890")).toBe("ok");
  });

  it("reports a rejected key only when Tavily says 401 or 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(reply(403));
    expect(await verifyApiKey("tvly-bad-key-1234567890")).toBe("rejected");
    expect(await verifyApiKey("tvly-bad-key-1234567890")).toBe("rejected");
  });

  it("does not blame the key when Tavily itself is failing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(503));
    await expect(verifyApiKey("tvly-good-key-1234567890")).rejects.toThrow(/Try again/);
  });
});
