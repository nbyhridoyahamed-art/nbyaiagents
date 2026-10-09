import {
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  Globe,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  type LucideIcon,
  Plug,
  Settings,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "approvals" | "inbox";
}

export const NAV_SECTIONS: { id: string; items: NavItem[] }[] = [
  { id: "home", items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    id: "workforce",
    items: [
      { href: "/agents", label: "AI Employees", icon: Users },
      { href: "/departments", label: "Departments", icon: Building2 },
    ],
  },
  {
    id: "work",
    items: [
      { href: "/tasks", label: "Tasks", icon: ListChecks },
      { href: "/approvals", label: "Approvals", icon: CheckCircle2, badgeKey: "approvals" },
      { href: "/inbox", label: "Inbox", icon: Inbox, badgeKey: "inbox" },
    ],
  },
  {
    id: "build",
    items: [
      { href: "/workflows", label: "Workflows", icon: Workflow },
      { href: "/knowledge", label: "Knowledge", icon: BookOpen },
      { href: "/tools", label: "Tools", icon: Wrench },
      { href: "/integrations", label: "Integrations", icon: Plug },
    ],
  },
  {
    id: "insight",
    items: [
      { href: "/websites", label: "Websites", icon: Globe },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/templates", label: "Templates", icon: LayoutTemplate },
    ],
  },
  {
    id: "system",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/help", label: "Help", icon: HelpCircle },
    ],
  },
];

export const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Employees", icon: Users },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/workflows", label: "Workflows", icon: Workflow },
];

/** Labels for breadcrumb segments. */
export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  agents: "AI Employees",
  new: "Hire",
  departments: "Departments",
  tasks: "Tasks",
  approvals: "Approvals",
  inbox: "Inbox",
  workflows: "Workflows",
  knowledge: "Knowledge",
  tools: "Tools",
  integrations: "Integrations",
  analytics: "Analytics",
  websites: "Websites",
  templates: "Templates",
  settings: "Settings",
  help: "Help",
  office: "AI Office",
  notifications: "Notifications",
  admin: "Admin",
  runs: "Runs",
  members: "Members",
  policies: "Policies",
  "api-keys": "API Keys",
  providers: "AI Providers",
  audit: "Audit Log",
  activity: "Activity",
};

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
