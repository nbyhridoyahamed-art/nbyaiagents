import { AppError } from "@/lib/errors";

const API_VERSION = "2024-01";

function base(shop: string): string {
  return `https://${shop}/admin/api/${API_VERSION}`;
}

async function shopifyFetch(shop: string, path: string, accessToken: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${base(shop)}${path}`, { ...init, headers: { "X-Shopify-Access-Token": accessToken, "content-type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError("INTEGRATION_ERROR", `Shopify API returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

interface ShopifyOrder {
  id: number;
  name: string;
  email: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  created_at: string;
}

export async function findOrders(shop: string, accessToken: string, query: string, limit: number): Promise<ShopifyOrder[]> {
  const isEmail = query.includes("@");
  const params = new URLSearchParams({ status: "any", limit: String(limit) });
  if (isEmail) params.set("email", query);
  else params.set("name", query.startsWith("#") ? query : `#${query}`);
  const res = (await shopifyFetch(shop, `/orders.json?${params}`, accessToken)) as { orders?: ShopifyOrder[] };
  return res.orders ?? [];
}

interface ShopifyTransaction {
  id: number;
  kind: string;
  status: string;
  gateway: string;
}

async function findRefundableTransaction(shop: string, accessToken: string, orderId: number): Promise<ShopifyTransaction> {
  const res = (await shopifyFetch(shop, `/orders/${orderId}/transactions.json`, accessToken)) as { transactions?: ShopifyTransaction[] };
  const tx = (res.transactions ?? []).find((t) => (t.kind === "sale" || t.kind === "capture") && t.status === "success");
  if (!tx) throw new AppError("INTEGRATION_ERROR", "No completed payment transaction was found on this order to refund against.");
  return tx;
}

export async function issueRefund(shop: string, accessToken: string, orderNumber: string, amount: number, reason: string | undefined): Promise<{ refundId: number; orderId: number }> {
  const [order] = await findOrders(shop, accessToken, orderNumber, 1);
  if (!order) throw new AppError("VALIDATION", `No order matching "${orderNumber}" was found.`);
  const tx = await findRefundableTransaction(shop, accessToken, order.id);
  const body = { refund: { notify: true, note: reason ?? null, transactions: [{ parent_id: tx.id, amount: amount.toFixed(2), kind: "refund", gateway: tx.gateway }] } };
  const res = (await shopifyFetch(shop, `/orders/${order.id}/refunds.json`, accessToken, { method: "POST", body: JSON.stringify(body) })) as { refund?: { id: number } };
  if (!res.refund) throw new AppError("INTEGRATION_ERROR", "Shopify did not confirm the refund.");
  return { refundId: res.refund.id, orderId: order.id };
}
