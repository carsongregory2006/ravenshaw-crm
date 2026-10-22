import "server-only";
import { addDays, format } from "date-fns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCustomer, createInvoice, findCustomerByEmail, cancelInvoice, invoicePaymentUrl } from "@/lib/integrations/mercury";
import { integrations } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { sendEmailToContact } from "@/lib/comms";
import { contactLabel, money } from "@/lib/utils";
import type { Invoice, LineItemType } from "@/lib/types";

export interface InvoiceItem {
  name: string;
  amount: number;          // unit price
  qty?: number;
  kind: LineItemType;
  line_item_id?: string | null;
}

export interface IssueInvoiceInput {
  dealId?: string | null;
  clientId?: string | null;
  contactId: string;
  items: InvoiceItem[];
  dueDays?: number;
  description?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  actorId?: string | null;
}

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** Dominant kind for reporting/commissions: recurring if any recurring line, else milestone, else one_time. */
function invoiceKind(items: InvoiceItem[]): LineItemType {
  if (items.length && items.every((i) => i.kind === "recurring")) return "recurring";
  if (items.some((i) => i.kind === "milestone") && !items.some((i) => i.kind === "one_time")) return "milestone";
  return items.some((i) => i.kind === "one_time") ? "one_time" : items[0]?.kind ?? "one_time";
}

/** Ensures a Mercury AR customer exists for the contact; caches the id on the client record. */
async function ensureMercuryCustomer(contactId: string, clientId?: string | null): Promise<string> {
  const db = createAdminClient();
  if (clientId) {
    const { data: client } = await db.from("clients").select("mercury_customer_id").eq("id", clientId).single();
    if (client?.mercury_customer_id) return client.mercury_customer_id;
  }
  const { data: contact } = await db.from("contacts").select("*, company:companies(name)").eq("id", contactId).single();
  if (!contact?.email) throw new Error("Contact needs an email address to receive a Mercury invoice");
  const existing = await findCustomerByEmail(contact.email);
  const id = existing?.id ?? (await createCustomer({ name: contact.company?.name || contactLabel(contact), email: contact.email })).id;
  if (clientId) await db.from("clients").update({ mercury_customer_id: id }).eq("id", clientId);
  return id;
}

/** Push an existing invoice row to Mercury (create invoice + email). Updates the row with result or error. */
async function pushToMercury(invoiceId: string): Promise<Invoice> {
  const db = createAdminClient();
  const { data: inv } = await db.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  const lineItems = await loadInvoiceLines(inv as Invoice);
  try {
    if (!integrations.mercury()) throw new Error("Mercury is not configured (MERCURY_API_KEY missing)");
    if (!inv.contact_id) throw new Error("Invoice has no contact");
    const customerId = inv.mercury_customer_id || (await ensureMercuryCustomer(inv.contact_id, inv.client_id));
    const m = await createInvoice({
      customerId,
      invoiceNumber: inv.invoice_number,
      invoiceDate: ymd(new Date()),
      dueDate: inv.due_date ?? ymd(addDays(new Date(), 7)),
      lineItems,
      payerMemo: inv.description ?? undefined,
      sendEmailOption: "SendNow",
    });
    const payment_url = invoicePaymentUrl(m);
    const { data: updated } = await db.from("invoices").update({
      mercury_invoice_id: m.id, mercury_customer_id: customerId, payment_url, status: "sent", error: null, issued_at: new Date().toISOString(),
    }).eq("id", invoiceId).select("*").single();
    await logActivity({ type: "invoice", title: `Invoice ${inv.invoice_number} sent (${money(inv.amount, { cents: true })})`, contact_id: inv.contact_id, deal_id: inv.deal_id, client_id: inv.client_id, metadata: { invoice_id: inv.id } });
    if (payment_url && inv.contact_id) {
      // Mercury emails the invoice too; this branded note makes sure the payment link lands from us as well.
      await sendEmailToContact(inv.contact_id, `Invoice ${inv.invoice_number} from {{agency_name}}`,
        `Hi {{first_name}},\n\nYour invoice ${inv.invoice_number} for ${money(inv.amount, { cents: true })} is ready${inv.due_date ? ` and due ${inv.due_date}` : ""}.\n\nPay securely by ACH or card here: ${payment_url}\n\n${lineItems.map((l) => `• ${l.name} — ${money(l.unitPrice * l.quantity, { cents: true })}`).join("\n")}\n\nThank you!\n{{agency_name}}`,
      ).catch(() => null);
    }
    return updated as Invoice;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const { data: updated } = await db.from("invoices").update({ status: "error", error }).eq("id", invoiceId).select("*").single();
    await logActivity({ type: "invoice", title: `Invoice ${inv.invoice_number} failed to send`, body: error, contact_id: inv.contact_id, deal_id: inv.deal_id, client_id: inv.client_id, metadata: { invoice_id: inv.id } });
    return updated as Invoice;
  }
}

/** Line items are kept in app_kv (invoice_lines:<id>); fall back to a single line for the total. */
async function loadInvoiceLines(inv: Invoice) {
  const db = createAdminClient();
  const { data: lines } = await db.from("app_kv").select("value").eq("key", `invoice_lines:${inv.id}`).maybeSingle();
  const stored = (lines?.value as { items?: InvoiceItem[] } | null)?.items;
  if (stored?.length) return stored.map((i) => ({ name: i.name, unitPrice: Number(i.amount), quantity: i.qty ?? 1 }));
  return [{ name: inv.description || `Invoice ${inv.invoice_number}`, unitPrice: Number(inv.amount), quantity: 1 }];
}

/** Create an invoice in the CRM and send it through Mercury. Never throws for Mercury failures: the row is kept with status=error. */
export async function issueInvoice(input: IssueInvoiceInput): Promise<Invoice> {
  const db = createAdminClient();
  const items = input.items.filter((i) => Number(i.amount) * (i.qty ?? 1) !== 0);
  if (!items.length) throw new Error("Invoice has no billable items");
  const amount = items.reduce((a, i) => a + Number(i.amount) * (i.qty ?? 1), 0);
  if (amount <= 0) throw new Error("Invoice total must be positive");

  let dueDays = input.dueDays;
  if (dueDays == null) {
    const { data: s } = await db.from("workspace_settings").select("invoice_due_days").eq("id", 1).single();
    dueDays = s?.invoice_due_days ?? 7;
  }
  let clientId = input.clientId ?? null;
  if (!clientId && input.dealId) {
    const { data: c } = await db.from("clients").select("id").eq("deal_id", input.dealId).maybeSingle();
    clientId = c?.id ?? null;
  }

  const { data: inv, error } = await db.from("invoices").insert({
    deal_id: input.dealId ?? null,
    client_id: clientId,
    contact_id: input.contactId,
    line_item_id: items.length === 1 ? items[0].line_item_id ?? null : null,
    kind: invoiceKind(items),
    description: input.description ?? items.map((i) => i.name).join(", "),
    amount,
    status: "draft",
    due_date: ymd(addDays(new Date(), dueDays ?? 7)),
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
  }).select("*").single();
  if (error || !inv) throw new Error(error?.message ?? "Could not create invoice");
  await db.from("app_kv").upsert({ key: `invoice_lines:${inv.id}`, value: { items }, updated_at: new Date().toISOString() });
  return pushToMercury(inv.id);
}

export async function retryInvoice(invoiceId: string) {
  const db = createAdminClient();
  const { data: inv } = await db.from("invoices").select("status").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "paid" || inv.status === "void") throw new Error(`Invoice is already ${inv.status}`);
  return pushToMercury(invoiceId);
}

export async function voidInvoice(invoiceId: string, actorId?: string | null) {
  const db = createAdminClient();
  const { data: inv } = await db.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "paid") throw new Error("Paid invoices can't be voided");
  if (inv.mercury_invoice_id && integrations.mercury()) await cancelInvoice(inv.mercury_invoice_id);
  await db.from("invoices").update({ status: "void" }).eq("id", invoiceId);
  await logActivity({ type: "invoice", title: `Invoice ${inv.invoice_number} voided`, contact_id: inv.contact_id, deal_id: inv.deal_id, client_id: inv.client_id, actor_id: actorId ?? null });
}

/** Look up the stored line items for an invoice (for display). */
export async function getInvoiceLines(invoiceId: string): Promise<InvoiceItem[]> {
  const { data } = await createAdminClient().from("app_kv").select("value").eq("key", `invoice_lines:${invoiceId}`).maybeSingle();
  return ((data?.value as { items?: InvoiceItem[] } | null)?.items) ?? [];
}
