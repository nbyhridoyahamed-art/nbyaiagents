export const INDUSTRIES = [
  "E-commerce",
  "Agency",
  "SaaS / Software",
  "Professional services",
  "Consulting",
  "Real estate",
  "Healthcare",
  "Education",
  "Hospitality",
  "Manufacturing",
  "Finance",
  "Non-profit",
  "Other",
];

export const COMPANY_SIZES = ["Just me", "2–10", "11–50", "51–200", "201+"];

export const BUSINESS_GOALS = [
  { key: "more_leads", label: "Generate more leads", departments: ["Sales"] },
  { key: "faster_support", label: "Answer customers faster", departments: ["Customer Support"] },
  { key: "content", label: "Publish more content", departments: ["Marketing"] },
  { key: "seo", label: "Improve search rankings", departments: ["Marketing"] },
  { key: "research", label: "Research markets & competitors", departments: ["Research"] },
  { key: "admin", label: "Reduce admin work", departments: ["Executive", "Operations"] },
  { key: "hiring", label: "Hire faster", departments: ["HR"] },
  { key: "projects", label: "Keep projects on track", departments: ["Operations"] },
] as const;

export type BusinessGoalKey = (typeof BUSINESS_GOALS)[number]["key"];

/** Maps chosen goals to recommended employee template keys (see lib/templates). */
export const GOAL_TEMPLATE_MAP: Record<BusinessGoalKey, string[]> = {
  more_leads: ["sales-representative"],
  faster_support: ["customer-support-agent"],
  content: ["content-writer", "social-media-manager"],
  seo: ["seo-specialist"],
  research: ["research-assistant"],
  admin: ["executive-assistant"],
  hiring: ["recruiter"],
  projects: ["project-manager"],
};

export function recommendTemplates(goals: string[]): string[] {
  const keys = new Set<string>();
  for (const g of goals) for (const t of GOAL_TEMPLATE_MAP[g as BusinessGoalKey] ?? []) keys.add(t);
  if (keys.size === 0) ["sales-representative", "customer-support-agent", "marketing-manager", "research-assistant"].forEach((k) => keys.add(k));
  return [...keys].slice(0, 6);
}
