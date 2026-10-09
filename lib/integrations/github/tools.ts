import { z } from "zod";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/tools/types";
import { AppError } from "@/lib/errors";
import * as github from "@/lib/integrations/github/client";

const real = (output: unknown, summary: string): ToolResult => ({ output, summary, simulated: false });

function def<S extends z.ZodType>(d: Omit<ToolDefinition<S>, "simulate"> & { simulate?: ToolDefinition<S>["simulate"] }): ToolDefinition {
  return { ...d, simulate: d.simulate ?? d.execute } as unknown as ToolDefinition;
}

function requireToken(ctx: Pick<ToolExecutionContext, "secret">): string {
  if (!ctx.secret) throw new AppError("NOT_CONFIGURED", "GitHub isn't connected for this workspace yet.");
  return ctx.secret;
}

const owner = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "Not a valid GitHub user or organization name").describe("Repository owner (user or organization)");
const repo = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/, "Not a valid repository name").describe("Repository name");
const state = z.enum(["open", "closed", "all"]);
const limit = z.number().int().min(1).max(50);

/** Rejects paths that try to leave the repository or contain empty segments. */
export function cleanPath(path: string): string {
  const parts = path.split("/").filter((p) => p !== "");
  if (parts.some((p) => p === "." || p === "..")) throw new AppError("VALIDATION", "The path can't contain . or .. segments.");
  return parts.join("/");
}

export const GITHUB_TOOLS: ToolDefinition[] = [
  def({
    key: "github.list_repos",
    integrationKey: "github",
    name: "List repositories",
    description: "List the repositories the connected token can access, most recently updated first.",
    inputSchema: z.object({ limit: limit.optional() }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const repos = await github.listRepos(requireToken(ctx), input.limit ?? 20);
      return real({ repos }, `${repos.length} repositor${repos.length === 1 ? "y" : "ies"}`);
    },
  }),
  def({
    key: "github.list_issues",
    integrationKey: "github",
    name: "List issues",
    description: "List issues in a repository (pull requests are not included).",
    inputSchema: z.object({ owner, repo, state: state.optional(), limit: limit.optional() }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const issues = await github.listIssues(requireToken(ctx), input.owner, input.repo, input.state ?? "open", input.limit ?? 20);
      return real({ issues }, `${issues.length} issue${issues.length === 1 ? "" : "s"} in ${input.owner}/${input.repo}`);
    },
  }),
  def({
    key: "github.list_pull_requests",
    integrationKey: "github",
    name: "List pull requests",
    description: "List pull requests in a repository.",
    inputSchema: z.object({ owner, repo, state: state.optional(), limit: limit.optional() }),
    riskLevel: "LOW",
    capabilities: ["read_only"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const pulls = await github.listPulls(requireToken(ctx), input.owner, input.repo, input.state ?? "open", input.limit ?? 20);
      return real({ pullRequests: pulls }, `${pulls.length} pull request${pulls.length === 1 ? "" : "s"} in ${input.owner}/${input.repo}`);
    },
  }),
  def({
    key: "github.read_file",
    integrationKey: "github",
    name: "Read file or folder",
    description: "Read a text file (up to about 60,000 characters) or list a folder in a repository. Leave the path empty for the top level.",
    inputSchema: z.object({ owner, repo, path: z.string().max(500).optional(), ref: z.string().max(200).optional().describe("Branch, tag or commit (default: the default branch)") }),
    riskLevel: "LOW",
    capabilities: ["read_only", "sensitive_data"],
    simulated: false,
    idempotent: true,
    async execute(input, ctx) {
      const path = cleanPath(input.path ?? "");
      const result = await github.readPath(requireToken(ctx), input.owner, input.repo, path, input.ref);
      return real(result, result.type === "dir" ? `${result.entries.length} entries in ${input.owner}/${input.repo}/${path}` : `Read ${input.owner}/${input.repo}/${result.path}`);
    },
  }),
  def({
    key: "github.create_issue",
    integrationKey: "github",
    name: "Create issue",
    description: "Open a new issue in a repository. This is visible to everyone who can see the repository.",
    inputSchema: z.object({ owner, repo, title: z.string().min(1).max(256), body: z.string().max(20_000).optional(), labels: z.array(z.string().min(1).max(50)).max(10).optional() }),
    riskLevel: "MEDIUM",
    capabilities: ["data_modification", "publishing"],
    simulated: false,
    idempotent: false,
    async execute(input, ctx) {
      const issue = await github.createIssue(requireToken(ctx), input.owner, input.repo, input.title, input.body, input.labels);
      return real(issue, `Opened issue #${issue.number} in ${input.owner}/${input.repo}`);
    },
    async simulate(input) {
      return real({ wouldCreate: input }, `Would open an issue in ${input.owner}/${input.repo}: ${input.title}`);
    },
  }),
  def({
    key: "github.comment_on_issue",
    integrationKey: "github",
    name: "Comment on issue or pull request",
    description: "Add a comment to an issue or pull request. This is visible to everyone who can see the repository.",
    inputSchema: z.object({ owner, repo, number: z.number().int().min(1), body: z.string().min(1).max(20_000) }),
    riskLevel: "MEDIUM",
    capabilities: ["data_modification", "publishing"],
    simulated: false,
    idempotent: false,
    async execute(input, ctx) {
      const comment = await github.commentOnIssue(requireToken(ctx), input.owner, input.repo, input.number, input.body);
      return real(comment, `Commented on #${input.number} in ${input.owner}/${input.repo}`);
    },
    async simulate(input) {
      return real({ wouldComment: input }, `Would comment on #${input.number} in ${input.owner}/${input.repo}`);
    },
  }),
];
