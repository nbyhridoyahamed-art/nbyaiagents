import type { GraphIssue } from "@/lib/workflows/validate-graph";
import type { WorkflowGraph, WorkflowSettings } from "@/lib/workflows/types";
import type { RiskLevel, WorkflowStatus } from "@/lib/generated/prisma/enums";

export interface EditorAgent {
  id: string;
  name: string;
  jobTitle: string;
  published: boolean;
  color: string;
  paused: boolean;
}

export interface EditorTool {
  key: string;
  name: string;
  riskLevel: RiskLevel;
  simulated: boolean;
  enabled: boolean;
  fields: { name: string; type: string; description: string; required: boolean }[];
}

export interface EditorOptions {
  agents: EditorAgent[];
  tools: EditorTool[];
}

export interface WorkflowEditorProps {
  workflow: {
    id: string;
    name: string;
    description: string;
    status: WorkflowStatus;
    publishedVersion: number | null;
    draftVersion: number;
    draftIsPublished: boolean;
    lastSimulationOk: boolean;
  };
  graph: WorkflowGraph;
  settings: WorkflowSettings;
  options: EditorOptions;
  initialIssues: GraphIssue[];
  runs: { id: string; status: string; mode: string; createdAt: string; version: number }[];
  webhookUrl: string | null;
  webhookEnabled: boolean;
  permissions: { write: boolean; publish: boolean; run: boolean };
  /** Open the "Run workflow" dialog on arrival (from the command palette / workflow list). */
  autoOpenRun?: boolean;
}
