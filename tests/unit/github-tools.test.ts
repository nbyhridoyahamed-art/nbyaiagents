import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyToken } from "@/lib/integrations/github/client";
import { GITHUB_TOOLS, cleanPath } from "@/lib/integrations/github/tools";
import type { ToolExecutionContext } from "@/lib/tools/types";

afterEach(() => vi.restoreAllMocks());

const ctx = { secret: "github_pat_test_token_1234567890" } as ToolExecutionContext;
const tool = (key: string) => GITHUB_TOOLS.find((t) => t.key === key)!;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

function lastCall(fetchMock: ReturnType<typeof vi.spyOn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
  return { url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined, method: init?.method ?? "GET" };
}

describe("verifyToken", () => {
  it("returns the login for a valid token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ login: "octocat" }));
    expect(await verifyToken("github_pat_x")).toEqual({ login: "octocat" });
    expect(lastCall(fetchMock).url).toBe("https://api.github.com/user");
  });

  it("calls only a 401 a rejected token; other failures are not blamed on the token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ message: "Bad credentials" }, 401)).mockResolvedValueOnce(json({}, 503));
    expect(await verifyToken("github_pat_bad")).toBe("rejected");
    await expect(verifyToken("github_pat_x")).rejects.toThrow(/Try again/);
  });
});

describe("GitHub read tools", () => {
  it("sends the headers GitHub requires", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
    await tool("github.list_repos").execute({}, ctx);
    const { headers, url } = lastCall(fetchMock);
    expect(url).toContain("https://api.github.com/user/repos?");
    expect(headers.authorization).toBe("Bearer github_pat_test_token_1234567890");
    expect(headers["user-agent"]).toBeTruthy();
    expect(headers["x-github-api-version"]).toBe("2022-11-28");
  });

  it("lists issues without pull requests and respects the limit", async () => {
    const issue = (n: number, extra: object = {}) => ({ number: n, title: `Issue ${n}`, state: "open", user: { login: "a" }, labels: [{ name: "bug" }], comments: 0, created_at: "x", updated_at: "y", html_url: `https://github.com/o/r/issues/${n}`, body: "b".repeat(900), ...extra });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json([issue(1), issue(2, { pull_request: {} }), issue(3), issue(4)]));
    const res = await tool("github.list_issues").execute({ owner: "o", repo: "r", limit: 2 }, ctx);
    const issues = (res.output as { issues: { number: number; body: string; labels: string[] }[] }).issues;
    expect(issues.map((i) => i.number)).toEqual([1, 3]);
    expect(issues[0].labels).toEqual(["bug"]);
    expect(issues[0].body).toHaveLength(500);
  });

  it("reads a file, decoding base64 and truncating very long files", async () => {
    const text = "x".repeat(70_000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ type: "file", path: "README.md", size: text.length, encoding: "base64", content: Buffer.from(text).toString("base64") }));
    const res = await tool("github.read_file").execute({ owner: "o", repo: "r", path: "README.md" }, ctx);
    const out = res.output as { type: string; truncated: boolean; content: string };
    expect(out.type).toBe("file");
    expect(out.truncated).toBe(true);
    expect(out.content).toHaveLength(60_000);
  });

  it("lists a folder and encodes path segments", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json([{ name: "a b.md", path: "docs/a b.md", type: "file", size: 5 }]));
    const res = await tool("github.read_file").execute({ owner: "o", repo: "r", path: "docs/sub dir", ref: "feat/x" }, ctx);
    expect(lastCall(fetchMock).url).toBe("https://api.github.com/repos/o/r/contents/docs/sub%20dir?ref=feat%2Fx");
    expect(res.output).toMatchObject({ type: "dir", entries: [{ name: "a b.md" }] });
  });

  it("refuses paths that try to leave the repository", () => {
    expect(() => cleanPath("../secrets")).toThrow(/segments/);
    expect(() => cleanPath("docs/../../x")).toThrow(/segments/);
    expect(cleanPath("/docs//guide.md")).toBe("docs/guide.md");
  });

  it("rejects bad owner and repo names before any request", () => {
    const schema = tool("github.list_issues").inputSchema;
    expect(schema.safeParse({ owner: "octo-org", repo: "my.repo_1" }).success).toBe(true);
    expect(schema.safeParse({ owner: "../etc", repo: "r" }).success).toBe(false);
    expect(schema.safeParse({ owner: "o", repo: "r/extra" }).success).toBe(false);
  });

  it("explains 401 and 404 in plain language", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({}, 404));
    await expect(tool("github.list_pull_requests").execute({ owner: "o", repo: "r" }, ctx)).rejects.toThrow(/connect it again/);
    await expect(tool("github.list_pull_requests").execute({ owner: "o", repo: "r" }, ctx)).rejects.toThrow(/couldn't find that/);
  });
});

describe("GitHub write tools", () => {
  it("creates an issue", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ number: 42, html_url: "https://github.com/o/r/issues/42" }, 201));
    const res = await tool("github.create_issue").execute({ owner: "o", repo: "r", title: "Fix title tags", body: "Details", labels: ["seo"] }, ctx);
    const call = lastCall(fetchMock);
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api.github.com/repos/o/r/issues");
    expect(call.body).toEqual({ title: "Fix title tags", body: "Details", labels: ["seo"] });
    expect(res.output).toEqual({ number: 42, url: "https://github.com/o/r/issues/42" });
  });

  it("is a medium-risk, approval-worthy action and simulates without calling GitHub", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    for (const key of ["github.create_issue", "github.comment_on_issue"]) {
      expect(tool(key).riskLevel).toBe("MEDIUM");
      expect(tool(key).capabilities).toContain("publishing");
    }
    const res = await tool("github.comment_on_issue").simulate({ owner: "o", repo: "r", number: 3, body: "hi" }, ctx);
    expect(res.summary).toMatch(/Would comment/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
