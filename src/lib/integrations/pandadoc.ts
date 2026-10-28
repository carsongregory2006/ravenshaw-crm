import "server-only";
import crypto from "node:crypto";
import { need } from "@/lib/env";

const API = "https://api.pandadoc.com/public/v1";

async function pd<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const key = need("PANDADOC_API_KEY", "PandaDoc");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `API-Key ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PandaDoc ${res.status}: ${text}`);
  return text ? JSON.parse(text) : ({} as T);
}

export async function listTemplates() {
  const data = await pd<{ results: { id: string; name: string; date_modified: string }[] }>("/templates?count=100");
  return data.results;
}

export interface CreateDocInput {
  name: string;
  templateId: string;
  recipient: { email: string; first_name?: string; last_name?: string; role?: string };
  sender?: { email: string; first_name?: string; last_name?: string; role?: string };
  tokens: Record<string, string | number>;               // template variables, e.g. Client.Company
  pricingRows?: { name: string; description?: string; price: number; qty: number }[];
  pricingTableName?: string;
  metadata?: Record<string, string>;
}

export async function createDocumentFromTemplate(input: CreateDocInput) {
  const recipients = [{ role: input.recipient.role ?? "Client", ...input.recipient }];
  if (input.sender) recipients.push({ role: input.sender.role ?? "Sender", ...input.sender });
  const body: Record<string, unknown> = {
    name: input.name,
    template_uuid: input.templateId,
    recipients,
    tokens: Object.entries(input.tokens).map(([name, value]) => ({ name, value: String(value) })),
    metadata: input.metadata,
  };
  // Only fill a pricing table if the template has one (the agreement text can carry the totals instead).
  const tableName = input.pricingTableName ?? "Pricing Table 1";
  const hasTable = input.pricingRows?.length
    ? await pd<{ pricing?: { tables?: { name: string }[] } }>(`/templates/${input.templateId}/details`)
        .then((t) => (t.pricing?.tables ?? []).some((x) => x.name === tableName)).catch(() => true)
    : false;
  if (hasTable && input.pricingRows?.length) {
    body.pricing_tables = [{
      name: tableName,
      data_merge: true,
      sections: [{
        title: "Services",
        default: true,
        rows: input.pricingRows.map((r) => ({
          options: { optional: false, optional_selected: true, qty_editable: false },
          data: { Name: r.name, Description: r.description ?? "", Price: r.price, QTY: r.qty },
        })),
      }],
    }];
  }
  return pd<{ id: string; status: string; name: string }>("/documents", { method: "POST", body: JSON.stringify(body) });
}

export async function getDocumentStatus(id: string) {
  return pd<{ id: string; status: string; name: string; date_completed?: string }>(`/documents/${id}`);
}

export async function sendDocument(id: string, opts: { subject?: string; message?: string } = {}) {
  return pd(`/documents/${id}/send`, { method: "POST", body: JSON.stringify({ subject: opts.subject, message: opts.message, silent: false }) });
}

/** Waits (briefly) for a newly created document to leave "document.uploaded" then sends it. */
export async function createAndSend(input: CreateDocInput, opts: { subject?: string; message?: string } = {}) {
  const doc = await createDocumentFromTemplate(input);
  for (let i = 0; i < 12; i++) {
    const s = await getDocumentStatus(doc.id);
    if (s.status === "document.draft") {
      await sendDocument(doc.id, opts);
      return { id: doc.id, sent: true };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { id: doc.id, sent: false }; // cron will retry sending drafts
}

export async function createSessionLink(id: string, recipientEmail: string) {
  const data = await pd<{ id: string }>(`/documents/${id}/session`, { method: "POST", body: JSON.stringify({ recipient: recipientEmail, lifetime: 3600 }) });
  return `https://app.pandadoc.com/s/${data.id}`;
}

export const documentAppUrl = (id: string) => `https://app.pandadoc.com/a/#/documents/${id}`;

/** PandaDoc signs with HMAC-SHA256(body, shared key) passed as ?signature= */
export function verifyPandaDocWebhook(rawBody: string, signature: string | null): boolean {
  const key = process.env.PANDADOC_WEBHOOK_KEY;
  if (!key) return true;
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", key).update(rawBody).digest("hex");
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
