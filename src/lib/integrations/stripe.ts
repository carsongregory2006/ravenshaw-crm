import "server-only";
import crypto from "node:crypto";
import { need } from "@/lib/env";

/**
 * Stripe invoicing (no SDK: form-encoded REST). The API version is pinned so response shapes stay stable,
 * and webhooks re-fetch the invoice through this client instead of trusting the event payload's version.
 */
const API = "https://api.stripe.com/v1";
const VERSION = "2024-06-20";

type Params = Record<string, unknown>;

/** Stripe's bracket notation: {a: {b: 1}, c: [x]} → a[b]=1&c[0]=x */
function encode(params: Params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? encode(item as Params, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === "object") encode(v as Params, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe<T = any>(path: string, opts: { method?: "GET" | "POST"; params?: Params; idempotencyKey?: string } = {}): Promise<T> {
  const key = need("STRIPE_SECRET_KEY", "Stripe");
  const method = opts.method ?? "GET";
  const qs = opts.params ? encode(opts.params).toString() : "";
  const res = await fetch(`${API}${path}${method === "GET" && qs ? `?${qs}` : ""}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    body: method === "POST" ? qs : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
  return data as T;
}

export interface StripeInvoice {
  id: string;
  status: "draft" | "open" | "paid" | "uncollectible" | "void";
  amount_due: number;
  amount_paid: number;
  currency: string;
  hosted_invoice_url?: string | null;
  metadata?: Record<string, string>;
  status_transitions?: { paid_at?: number | null };
  charge?: string | { id: string; balance_transaction?: string | { id: string; fee: number; currency: string } | null } | null;
}

export async function findOrCreateCustomer(input: { email: string; name: string; contactId: string }): Promise<string> {
  const found = await stripe<{ data: { id: string }[] }>("/customers", { params: { email: input.email, limit: 1 } });
  if (found.data[0]) return found.data[0].id;
  const c = await stripe<{ id: string }>("/customers", {
    method: "POST", params: { email: input.email, name: input.name, metadata: { crm_contact_id: input.contactId } },
    idempotencyKey: `customer-${input.contactId}`,
  });
  return c.id;
}

/** Creates, finalizes and emails a Stripe invoice. Idempotent per CRM invoice id. */
export async function createAndSendInvoice(input: {
  crmInvoiceId: string; invoiceNumber: string; customerId: string; currency: string; daysUntilDue: number;
  lineItems: { name: string; unitPrice: number; quantity: number }[]; description?: string;
}): Promise<StripeInvoice> {
  const currency = input.currency.toLowerCase();
  // A retry after a partial failure picks up the invoice created last time instead of making a second one.
  const prior = await stripe<{ data: (StripeInvoice & { lines?: { total_count?: number } })[] }>("/invoices", {
    params: { customer: input.customerId, limit: 100 },
  });
  let inv: StripeInvoice | undefined = prior.data.find((i) => i.metadata?.crm_invoice_id === input.crmInvoiceId && i.status !== "void");
  if (!inv) {
    inv = await stripe<StripeInvoice>("/invoices", {
      method: "POST",
      params: {
        customer: input.customerId, currency, collection_method: "send_invoice", days_until_due: Math.max(0, input.daysUntilDue),
        auto_advance: true, pending_invoice_items_behavior: "exclude", description: input.description,
        metadata: { crm_invoice_id: input.crmInvoiceId, crm_invoice_number: input.invoiceNumber },
      },
    });
  }
  if (inv.status === "draft") {
    const lines = await stripe<{ data: unknown[] }>(`/invoices/${inv.id}/lines`, { params: { limit: 1 } });
    if (!lines.data.length) {
      for (const [i, l] of input.lineItems.entries()) {
        await stripe("/invoiceitems", {
          method: "POST",
          params: {
            customer: input.customerId, invoice: inv.id, currency, description: l.quantity > 1 ? `${l.name} × ${l.quantity}` : l.name,
            amount: Math.round(l.unitPrice * l.quantity * 100),
          },
          idempotencyKey: `invoiceitem-${inv.id}-${i}`,
        });
      }
    }
    inv = await stripe<StripeInvoice>(`/invoices/${inv.id}/finalize`, { method: "POST", params: { auto_advance: true } });
  }
  if (inv.status === "open") return stripe<StripeInvoice>(`/invoices/${inv.id}/send`, { method: "POST" });
  return inv;
}

export async function getInvoice(id: string): Promise<StripeInvoice> {
  return stripe<StripeInvoice>(`/invoices/${id}`, { params: { expand: ["charge.balance_transaction"] } });
}

export async function voidInvoice(id: string) {
  const inv = await getInvoice(id);
  if (inv.status === "paid") throw new Error("Invoice is already paid in Stripe");
  if (inv.status === "open" || inv.status === "uncollectible") return stripe<StripeInvoice>(`/invoices/${id}/void`, { method: "POST" });
  return inv; // drafts never reach the customer; already-void needs nothing
}

/** Processing fee (in major units) for a paid invoice's charge, when Stripe exposes it. */
export function invoiceFee(inv: StripeInvoice): { fee: number; ref: string } | null {
  const charge = typeof inv.charge === "object" ? inv.charge : null;
  const bt = charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
  return bt && bt.fee > 0 ? { fee: bt.fee / 100, ref: bt.id } : null;
}

/** Verify the Stripe-Signature header (HMAC-SHA256 of "<t>.<raw body>", 5 minute tolerance). */
export function verifyStripeWebhook(raw: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
