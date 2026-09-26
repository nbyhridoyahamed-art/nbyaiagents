import type { PolicyEnforcement } from "@/lib/policies/types";

export interface DefaultPolicy {
  name: string;
  rule: string;
  enforcement: PolicyEnforcement | null;
}

/** Company-wide AI policy every new organization starts with (editable). */
export const DEFAULT_ORG_POLICIES: DefaultPolicy[] = [
  {
    name: "Confidentiality",
    rule: "Never disclose confidential information, credentials, or internal data to people outside the company.",
    enforcement: null,
  },
  {
    name: "External communications need approval",
    rule: "Never send external communications (email, messages, posts) without human approval.",
    enforcement: { type: "require_approval_capability", capability: "external_communication" },
  },
  {
    name: "No deletion of customer records",
    rule: "Never delete customer records.",
    enforcement: { type: "deny_capability", capability: "data_deletion" },
  },
  {
    name: "No financial transactions",
    rule: "Never make payments, refunds, transfers or any other financial transaction.",
    enforcement: { type: "deny_capability", capability: "financial" },
  },
  {
    name: "Use approved knowledge",
    rule: "Use approved company knowledge where applicable and cite it. Do not invent facts, prices or policies.",
    enforcement: null,
  },
  {
    name: "Escalate uncertainty",
    rule: "Escalate uncertain customer issues to a human instead of guessing.",
    enforcement: null,
  },
];

export const DEFAULT_DEPARTMENTS = [
  { name: "Executive", color: "#475467", icon: "crown" },
  { name: "Sales", color: "#5B5FEF", icon: "trending-up" },
  { name: "Marketing", color: "#7C5CFC", icon: "megaphone" },
  { name: "Customer Support", color: "#12B76A", icon: "headphones" },
  { name: "Operations", color: "#F79009", icon: "settings-2" },
  { name: "Finance", color: "#0E9384", icon: "landmark" },
  { name: "HR", color: "#DD2590", icon: "users" },
  { name: "Engineering", color: "#2E90FA", icon: "code-2" },
  { name: "Research", color: "#6172F3", icon: "flask-conical" },
] as const;
