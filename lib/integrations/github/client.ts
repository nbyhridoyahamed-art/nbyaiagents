import { AppError } from "@/lib/errors";

const API = "https://api.github.com";
const MAX_FILE_CHARS = 60_000;

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "VirtualDesksOnline",
    "content-type": "application/json",
  };
}

async function gh(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...authHeaders(token), ...init?.headers }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401) throw new AppError("INTEGRATION_ERROR", "GitHub rejected the saved token. Disconnect GitHub and connect it again with a new token.");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404) throw new AppError("INTEGRATION_ERROR", "GitHub couldn't find that, or the token has no access to it. Check the owner, the repository name and the token's repository access.");
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") throw new AppError("INTEGRATION_ERROR", "GitHub's rate limit was reached. Try again in a few minutes.");
    throw new AppError("INTEGRATION_ERROR", `GitHub returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Checks a token with GET /user (works for fine-grained tokens with no permissions). "rejected" only on 401. */
export async function verifyToken(token: string): Promise<{ login: string } | "rejected"> {
  const res = await fetch(`${API}/user`, { headers: authHeaders(token), signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) return "rejected";
  if (!res.ok) throw new AppError("INTEGRATION_ERROR", `GitHub returned HTTP ${res.status}. Try again in a minute.`);
  const user = (await res.json()) as { login?: string };
  return { login: user.login ?? "unknown" };
}

const clip = (text: string | null | undefined, max: number) => (text ?? "").slice(0, max);

interface RawUser {
  login?: string;
}

export async function listRepos(token: string, limit: number) {
  const params = new URLSearchParams({ per_page: String(limit), sort: "updated", affiliation: "owner,collaborator,organization_member" });
  const repos = (await gh(token, `/user/repos?${params}`)) as {
    full_name: string;
    private: boolean;
    description: string | null;
    default_branch: string;
    updated_at: string;
    open_issues_count: number;
    html_url: string;
  }[];
  return repos.map((r) => ({ fullName: r.full_name, private: r.private, description: r.description, defaultBranch: r.default_branch, updatedAt: r.updated_at, openIssues: r.open_issues_count, url: r.html_url }));
}

export async function listIssues(token: string, owner: string, repo: string, state: string, limit: number) {
  // The issues endpoint also returns pull requests; over-fetch so filtering them out still fills the page.
  const params = new URLSearchParams({ state, per_page: String(Math.min(100, limit * 2)), sort: "updated" });
  const items = (await gh(token, `/repos/${owner}/${repo}/issues?${params}`)) as {
    number: number;
    title: string;
    state: string;
    user: RawUser | null;
    labels: ({ name?: string } | string)[];
    comments: number;
    created_at: string;
    updated_at: string;
    html_url: string;
    body: string | null;
    pull_request?: unknown;
  }[];
  return items
    .filter((i) => !i.pull_request)
    .slice(0, limit)
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      author: i.user?.login ?? null,
      labels: i.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean),
      comments: i.comments,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      url: i.html_url,
      body: clip(i.body, 500),
    }));
}

export async function listPulls(token: string, owner: string, repo: string, state: string, limit: number) {
  const params = new URLSearchParams({ state, per_page: String(limit), sort: "updated", direction: "desc" });
  const items = (await gh(token, `/repos/${owner}/${repo}/pulls?${params}`)) as {
    number: number;
    title: string;
    state: string;
    draft?: boolean;
    user: RawUser | null;
    head: { ref: string };
    base: { ref: string };
    created_at: string;
    updated_at: string;
    html_url: string;
  }[];
  return items.map((p) => ({ number: p.number, title: p.title, state: p.state, draft: !!p.draft, author: p.user?.login ?? null, from: p.head.ref, into: p.base.ref, createdAt: p.created_at, updatedAt: p.updated_at, url: p.html_url }));
}

export type FileResult =
  | { type: "file"; path: string; size: number; truncated: boolean; content: string }
  | { type: "dir"; path: string; entries: { name: string; path: string; type: string; size: number }[] };

export async function readPath(token: string, owner: string, repo: string, path: string, ref?: string): Promise<FileResult> {
  const encoded = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = (await gh(token, `/repos/${owner}/${repo}/contents${encoded ? `/${encoded}` : ""}${query}`)) as unknown;
  if (Array.isArray(res)) {
    return { type: "dir", path, entries: res.map((e: { name: string; path: string; type: string; size: number }) => ({ name: e.name, path: e.path, type: e.type, size: e.size })) };
  }
  const file = res as { type: string; path: string; size: number; content?: string; encoding?: string };
  if (file.type !== "file") throw new AppError("VALIDATION", `That path is a ${file.type}, not a file or folder.`);
  if (file.encoding !== "base64" || file.content === undefined || file.content === "") {
    throw new AppError("VALIDATION", "GitHub doesn't return the contents of files over 1 MB. Pick a smaller file.");
  }
  const text = Buffer.from(file.content, "base64").toString("utf8");
  return { type: "file", path: file.path, size: file.size, truncated: text.length > MAX_FILE_CHARS, content: text.slice(0, MAX_FILE_CHARS) };
}

export async function createIssue(token: string, owner: string, repo: string, title: string, body: string | undefined, labels: string[] | undefined) {
  const res = (await gh(token, `/repos/${owner}/${repo}/issues`, { method: "POST", body: JSON.stringify({ title, ...(body ? { body } : {}), ...(labels?.length ? { labels } : {}) }) })) as { number: number; html_url: string };
  return { number: res.number, url: res.html_url };
}

export async function commentOnIssue(token: string, owner: string, repo: string, number: number, body: string) {
  const res = (await gh(token, `/repos/${owner}/${repo}/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body }) })) as { id: number; html_url: string };
  return { id: res.id, url: res.html_url };
}
