import { AppError } from "@/lib/errors";

const BASE = "https://api.hubapi.com/crm/v3/objects/contacts";

async function hubspotFetch(url: string, accessToken: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError("INTEGRATION_ERROR", `HubSpot API returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export interface HubspotContact {
  id: string;
  properties: Record<string, string | null>;
}

export async function searchContacts(accessToken: string, query: string, limit: number): Promise<HubspotContact[]> {
  const res = (await hubspotFetch(`${BASE}/search`, accessToken, {
    method: "POST",
    body: JSON.stringify({ query, limit, properties: ["email", "firstname", "lastname", "company", "lifecyclestage"] }),
  })) as { results?: HubspotContact[] };
  return res.results ?? [];
}

export async function createContact(accessToken: string, properties: Record<string, string>): Promise<HubspotContact> {
  return (await hubspotFetch(BASE, accessToken, { method: "POST", body: JSON.stringify({ properties }) })) as HubspotContact;
}

async function findContactIdByEmail(accessToken: string, email: string): Promise<string | null> {
  const results = await searchContacts(accessToken, email, 1);
  return results[0]?.id ?? null;
}

/** `idOrEmail` may be a HubSpot contact id or an email address (resolved via search). */
export async function updateContact(accessToken: string, idOrEmail: string, properties: Record<string, string | number>): Promise<HubspotContact> {
  const id = /^\d+$/.test(idOrEmail) ? idOrEmail : await findContactIdByEmail(accessToken, idOrEmail);
  if (!id) throw new AppError("VALIDATION", `No HubSpot contact matches "${idOrEmail}".`);
  return (await hubspotFetch(`${BASE}/${id}`, accessToken, { method: "PATCH", body: JSON.stringify({ properties }) })) as HubspotContact;
}

export async function archiveContact(accessToken: string, idOrEmail: string): Promise<boolean> {
  const id = /^\d+$/.test(idOrEmail) ? idOrEmail : await findContactIdByEmail(accessToken, idOrEmail);
  if (!id) return false;
  await hubspotFetch(`${BASE}/${id}`, accessToken, { method: "DELETE" });
  return true;
}
