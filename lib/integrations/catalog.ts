/**
 * Integration catalog. Availability is stated honestly:
 *  - "available": works today (simulated demo integrations, custom REST, webhooks).
 *  - "requires_setup": adapter architecture exists but needs OAuth app credentials
 *    from the platform operator before anyone can connect ("Not configured").
 *  - "coming_soon": planned; not connectable.
 */
export type IntegrationAvailability = "available" | "requires_setup" | "coming_soon";

/**
 * How a requires_setup integration gets connected:
 *  - "oauth2": platform-registered OAuth app; the org authorizes via a real consent
 *    screen (/api/integrations/{provider}/authorize). setupEnv names the platform's
 *    client id/secret.
 *  - "credential": the org pastes its own API key/token (no OAuth) — Shopify.
 *  - "platform_key": one operator-set key shared by every org, no per-org secret
 *    at all — Web Search.
 */
export type IntegrationAuthType = "oauth2" | "credential" | "platform_key";

export interface IntegrationInfo {
  key: string;
  name: string;
  category: "Communication" | "Productivity" | "CRM" | "Data" | "Commerce" | "Development" | "Research" | "Custom";
  description: string;
  availability: IntegrationAvailability;
  simulated?: boolean;
  authType?: IntegrationAuthType;
  /** OAuth provider this integration shares a grant with (see lib/integrations/oauth). */
  provider?: "google" | "hubspot";
  /** Env var(s) the operator must set for requires_setup integrations. */
  setupEnv?: string[];
  icon: string;
}

export const INTEGRATIONS: IntegrationInfo[] = [
  // Simulated demo integrations — clearly identifiable, never contact the outside world.
  { key: "mock_crm", name: "Mock CRM", category: "CRM", description: "Simulated CRM with contacts and leads for testing. Stored inside Virtual Desks only.", availability: "available", simulated: true, icon: "contact" },
  { key: "mock_email", name: "Mock Email", category: "Communication", description: "Simulated inbox and outbox. Messages are recorded, never delivered.", availability: "available", simulated: true, icon: "mail" },
  { key: "mock_calendar", name: "Mock Calendar", category: "Productivity", description: "Simulated calendar for scheduling tests.", availability: "available", simulated: true, icon: "calendar" },
  { key: "mock_search", name: "Mock Search", category: "Research", description: "Returns clearly-labelled sample search results and company profiles.", availability: "available", simulated: true, icon: "search" },
  { key: "mock_sheets", name: "Mock Google Sheets", category: "Data", description: "Simulated spreadsheets for reading and appending rows.", availability: "available", simulated: true, icon: "sheet" },
  { key: "mock_commerce", name: "Mock Store", category: "Commerce", description: "Simulated orders and refunds for support testing.", availability: "available", simulated: true, icon: "shopping-bag" },

  // Custom
  { key: "custom_http", name: "Custom REST API", category: "Custom", description: "Define your own API tools with auth, parameters and schemas.", availability: "available", icon: "code" },
  { key: "webhook", name: "Inbound Webhook", category: "Custom", description: "Trigger workflows from any system with signed HTTP requests.", availability: "available", icon: "webhook" },

  // Real providers — adapter architecture in place; require operator setup.
  { key: "gmail", name: "Gmail", category: "Communication", description: "Read, draft and send email.", availability: "requires_setup", authType: "oauth2", provider: "google", setupEnv: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], icon: "mail" },
  { key: "google_calendar", name: "Google Calendar", category: "Productivity", description: "Read and create calendar events.", availability: "requires_setup", authType: "oauth2", provider: "google", setupEnv: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], icon: "calendar" },
  { key: "google_drive", name: "Google Drive", category: "Productivity", description: "Search and read files; sync knowledge.", availability: "requires_setup", setupEnv: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], icon: "folder" },
  { key: "google_sheets", name: "Google Sheets", category: "Data", description: "Read and write spreadsheet rows.", availability: "requires_setup", authType: "oauth2", provider: "google", setupEnv: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], icon: "sheet" },
  { key: "hubspot", name: "HubSpot", category: "CRM", description: "Contacts, companies and deals.", availability: "requires_setup", authType: "oauth2", provider: "hubspot", setupEnv: ["HUBSPOT_OAUTH_CLIENT_ID", "HUBSPOT_OAUTH_CLIENT_SECRET"], icon: "contact" },
  { key: "web_search", name: "Web Search", category: "Research", description: "Real web search and company research (Tavily).", availability: "requires_setup", authType: "platform_key", setupEnv: ["TAVILY_API_KEY"], icon: "search" },
  { key: "shopify", name: "Shopify", category: "Commerce", description: "Orders, products and refunds for your store.", availability: "requires_setup", authType: "credential", setupEnv: [], icon: "shopping-bag" },
  { key: "outlook", name: "Outlook", category: "Communication", description: "Microsoft 365 mail.", availability: "coming_soon", icon: "mail" },
  { key: "slack", name: "Slack", category: "Communication", description: "Post and read channel messages.", availability: "coming_soon", icon: "message-square" },
  { key: "teams", name: "Microsoft Teams", category: "Communication", description: "Chat and channel messages.", availability: "coming_soon", icon: "message-square" },
  { key: "notion", name: "Notion", category: "Productivity", description: "Pages and databases; sync knowledge.", availability: "coming_soon", icon: "file-text" },
  { key: "dropbox", name: "Dropbox", category: "Productivity", description: "Files; sync knowledge.", availability: "coming_soon", icon: "folder" },
  { key: "salesforce", name: "Salesforce", category: "CRM", description: "Leads, accounts and opportunities.", availability: "coming_soon", icon: "contact" },
  { key: "pipedrive", name: "Pipedrive", category: "CRM", description: "Deals and contacts.", availability: "coming_soon", icon: "contact" },
  { key: "airtable", name: "Airtable", category: "Data", description: "Bases and records.", availability: "coming_soon", icon: "sheet" },
  { key: "woocommerce", name: "WooCommerce", category: "Commerce", description: "Orders and products.", availability: "coming_soon", icon: "shopping-bag" },
  { key: "github", name: "GitHub", category: "Development", description: "Issues and pull requests.", availability: "coming_soon", icon: "github" },
  { key: "gitlab", name: "GitLab", category: "Development", description: "Issues and merge requests.", availability: "coming_soon", icon: "gitlab" },
];

export function getIntegration(key: string) {
  return INTEGRATIONS.find((i) => i.key === key);
}

/** Whether the operator has set every env var a requires_setup integration needs. */
export function isIntegrationConfigured(key: string): boolean {
  const info = getIntegration(key);
  if (!info) return false;
  if (info.availability === "available") return true;
  if (info.availability !== "requires_setup") return false;
  if (info.authType === "credential") return true; // per-org secret, nothing platform-level to check
  return (info.setupEnv ?? []).every((name) => !!process.env[name]);
}
