import { AppError } from "@/lib/errors";

async function googleFetch(url: string, accessToken: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // A 403 from a Google API that was never enabled for the project is a setup step, not a bug.
    const notEnabled = res.status === 403 && /SERVICE_DISABLED|accessNotConfigured|has not been used in project/i.test(body);
    const hint = notEnabled ? " The API isn't enabled in the Google Cloud project yet. Enable it in the Google Cloud console, wait a minute and retry." : "";
    throw new AppError("INTEGRATION_ERROR", `Google API returned HTTP ${res.status}.${hint} ${body.slice(0, 300)}`.replace(/\s+$/, ""));
  }
  if (res.status === 204) return null;
  return res.json();
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Gmail ─────────────────────────────────────────────────────────────────

interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export async function gmailListMessages(accessToken: string, query: string | undefined, limit: number): Promise<GmailMessage[]> {
  const params = new URLSearchParams({ maxResults: String(limit) });
  if (query) params.set("q", query);
  const list = (await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, accessToken)) as { messages?: { id: string }[] };
  const ids = list.messages ?? [];
  const messages = await Promise.all(
    ids.map(async (m) => {
      const params2 = new URLSearchParams({ format: "metadata" });
      params2.append("metadataHeaders", "Subject");
      params2.append("metadataHeaders", "From");
      params2.append("metadataHeaders", "Date");
      const detail = (await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?${params2}`, accessToken)) as {
        id: string;
        snippet?: string;
        payload?: { headers?: { name: string; value: string }[] };
      };
      const header = (name: string) => detail.payload?.headers?.find((h) => h.name === name)?.value ?? "";
      return { id: detail.id, from: header("From"), subject: header("Subject"), date: header("Date"), snippet: detail.snippet ?? "" };
    }),
  );
  return messages;
}

export async function gmailSend(accessToken: string, to: string, subject: string, body: string): Promise<string> {
  const raw = base64url(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`);
  const res = (await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", accessToken, { method: "POST", body: JSON.stringify({ raw }) })) as { id: string };
  return res.id;
}

export async function gmailDraft(accessToken: string, to: string, subject: string, body: string): Promise<string> {
  const raw = base64url(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`);
  const res = (await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", accessToken, { method: "POST", body: JSON.stringify({ message: { raw } }) })) as { id: string };
  return res.id;
}

// ── Calendar ──────────────────────────────────────────────────────────────

export async function calendarListEvents(accessToken: string, days: number): Promise<unknown[]> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();
  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50" });
  const res = (await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, accessToken)) as { items?: unknown[] };
  return res.items ?? [];
}

export async function calendarCreateEvent(accessToken: string, title: string, startIso: string, durationMinutes: number, attendees: string[]): Promise<string> {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) throw new AppError("VALIDATION", `"${startIso}" isn't a valid date/time.`);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const body = { summary: title, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, attendees: attendees.map((email) => ({ email })) };
  const res = (await googleFetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", accessToken, { method: "POST", body: JSON.stringify(body) })) as { id: string };
  return res.id;
}

// ── Sheets ────────────────────────────────────────────────────────────────

export async function sheetsReadRows(accessToken: string, spreadsheetId: string, sheet: string, limit: number): Promise<unknown[][]> {
  const range = encodeURIComponent(`${sheet}!A1:ZZ${limit + 1}`);
  const res = (await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, accessToken)) as { values?: unknown[][] };
  return res.values ?? [];
}

export async function sheetsAppendRow(accessToken: string, spreadsheetId: string, sheet: string, row: unknown[]): Promise<void> {
  const range = encodeURIComponent(`${sheet}!A1`);
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`, accessToken, {
    method: "POST",
    body: JSON.stringify({ values: [row] }),
  });
}

// ── Search Console ───────────────────────────────────────────────────────

export interface SearchConsoleRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function searchConsoleListSites(accessToken: string): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const res = (await googleFetch("https://www.googleapis.com/webmasters/v3/sites", accessToken)) as { siteEntry?: { siteUrl: string; permissionLevel: string }[] };
  return res.siteEntry ?? [];
}

export async function searchConsoleQuery(
  accessToken: string,
  siteUrl: string,
  request: { startDate: string; endDate: string; dimensions: string[]; rowLimit: number; dimensionFilterGroups?: unknown[] },
): Promise<SearchConsoleRow[]> {
  const res = (await googleFetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, accessToken, {
    method: "POST",
    body: JSON.stringify(request),
  })) as { rows?: SearchConsoleRow[] };
  return res.rows ?? [];
}

export async function searchConsoleInspectUrl(accessToken: string, siteUrl: string, inspectionUrl: string): Promise<Record<string, unknown>> {
  const res = (await googleFetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", accessToken, {
    method: "POST",
    body: JSON.stringify({ inspectionUrl, siteUrl, languageCode: "en-US" }),
  })) as { inspectionResult?: Record<string, unknown> };
  return res.inspectionResult ?? {};
}

// ── Analytics (GA4) ──────────────────────────────────────────────────────

export async function analyticsListProperties(accessToken: string): Promise<{ account: string; accountName: string; property: string; displayName: string }[]> {
  const res = (await googleFetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", accessToken)) as {
    accountSummaries?: { account: string; displayName?: string; propertySummaries?: { property: string; displayName?: string }[] }[];
  };
  return (res.accountSummaries ?? []).flatMap((a) =>
    (a.propertySummaries ?? []).map((p) => ({ account: a.account, accountName: a.displayName ?? "", property: p.property, displayName: p.displayName ?? "" })),
  );
}

export interface AnalyticsReport {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  totals?: { metricValues?: { value: string }[] }[];
  rowCount?: number;
}

export async function analyticsRunReport(
  accessToken: string,
  property: string,
  request: { dateRanges: { startDate: string; endDate: string }[]; dimensions: { name: string }[]; metrics: { name: string }[]; limit: string; orderBys?: unknown[]; metricAggregations?: string[] },
): Promise<AnalyticsReport> {
  return (await googleFetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, accessToken, { method: "POST", body: JSON.stringify(request) })) as AnalyticsReport;
}
