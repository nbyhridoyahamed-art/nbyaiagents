import {
  Braces,
  Brackets,
  Clock,
  Code2,
  Columns3,
  Database,
  FileCheck,
  Filter,
  Flag,
  GitFork,
  Hand,
  Hourglass,
  ListTree,
  type LucideIcon,
  Merge,
  MessageCircleQuestion,
  PenLine,
  Play,
  Repeat,
  ScanSearch,
  Search,
  Shuffle,
  Sparkles,
  Split,
  Tags,
  Text,
  UserRound,
  Variable,
  Webhook,
  Wrench,
  Zap,
} from "lucide-react";
import type { NodeCategory, NodeType } from "@/lib/workflows/types";

export const NODE_ICONS: Record<string, LucideIcon> = {
  play: Play,
  clock: Clock,
  webhook: Webhook,
  code: Code2,
  zap: Zap,
  sparkles: Sparkles,
  "scan-search": ScanSearch,
  text: Text,
  tags: Tags,
  brackets: Brackets,
  "pen-line": PenLine,
  search: Search,
  "git-fork": GitFork,
  "user-round": UserRound,
  wrench: Wrench,
  split: Split,
  "list-tree": ListTree,
  filter: Filter,
  merge: Merge,
  repeat: Repeat,
  "columns-3": Columns3,
  hourglass: Hourglass,
  hand: Hand,
  "file-check": FileCheck,
  "message-circle-question": MessageCircleQuestion,
  variable: Variable,
  shuffle: Shuffle,
  braces: Braces,
  database: Database,
  flag: Flag,
};

export const CATEGORY_STYLES: Record<NodeCategory, { accent: string; soft: string }> = {
  Triggers: { accent: "#12B76A", soft: "color-mix(in oklab, #12B76A 14%, transparent)" },
  AI: { accent: "#7C5CFC", soft: "color-mix(in oklab, #7C5CFC 14%, transparent)" },
  Employees: { accent: "#5B5FEF", soft: "color-mix(in oklab, #5B5FEF 14%, transparent)" },
  Tools: { accent: "#2E90FA", soft: "color-mix(in oklab, #2E90FA 14%, transparent)" },
  Logic: { accent: "#F79009", soft: "color-mix(in oklab, #F79009 14%, transparent)" },
  Human: { accent: "#DD2590", soft: "color-mix(in oklab, #DD2590 14%, transparent)" },
  Data: { accent: "#475467", soft: "color-mix(in oklab, #475467 14%, transparent)" },
};

/** Sensible starting configuration for a freshly-dropped step. */
export function defaultConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "trigger.manual":
      return { inputFields: [] };
    case "trigger.schedule":
      return { cron: "0 8 * * *" };
    case "trigger.webhook":
      return { requireSignature: true };
    case "trigger.event":
      return { event: "crm.lead.created" };
    case "ai.prompt":
    case "ai.analyze":
    case "ai.generate":
      return { prompt: "" };
    case "ai.summarize":
      return { prompt: "Summarize the following in 3 bullet points:", input: "" };
    case "ai.classify":
      return { input: "", categories: ["Option A", "Option B"], instructions: "" };
    case "ai.extract":
      return { input: "", instructions: "", outputSpec: { name: "fields", fields: [{ name: "value", type: "string", description: "", required: true }] } };
    case "ai.decision":
      return { question: "", options: ["Yes", "No"] };
    case "ai.research":
      return { agentId: "", topic: "" };
    case "agent.run":
      return { agentId: "", instructions: "" };
    case "tool.call":
      return { toolKey: "", input: {} };
    case "logic.if":
    case "logic.filter":
      return { condition: { mode: "all", conditions: [{ left: "", op: "eq", right: "" }] } };
    case "logic.switch":
      return { cases: [{ handle: "case_1", label: "Case 1", condition: { mode: "all", conditions: [{ left: "", op: "eq", right: "" }] } }] };
    case "logic.loop":
      return { items: "", maxItems: 25, itemVar: "item" };
    case "logic.delay":
      return { seconds: 3600 };
    case "human.approval":
      return { title: "", details: "" };
    case "human.review":
      return { title: "", content: "" };
    case "human.input":
      return { question: "" };
    case "data.set":
      return { assignments: [{ name: "", value: "" }] };
    case "data.transform":
      return { template: {} };
    case "data.parse_json":
      return { source: "" };
    case "data.store":
      return { key: "result", value: "" };
    case "flow.end":
      return { output: "" };
    default:
      return {};
  }
}
