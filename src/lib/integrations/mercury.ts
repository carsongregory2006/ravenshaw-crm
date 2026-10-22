import "server-only";
import { need } from "@/lib/env";

/**
 * Mercury Bank API. Accounts/transactions are v1 core; invoicing is the Accounts Receivable API
 * (requires a Mercury plan with Invoicing). Mercury does not support recurring invoice series via API,
 * so the CRM's billing scheduler creates each recurring invoice itself.
 * Paths are centralized here so they can be adjusted if Mercury revises them.
 */
const BASE = process.env.MERCURY_API_BASE || "https://api.mercury.com/api/v1";
export const MERCURY_PATHS = {
  accounts: "/accounts",
  transactions: (accountId: string) => `/account/${accountId}/transactions`,
  customers: "/ar/customers",
  invoices: "/ar/invoices",
  invoice: (id: string) => `/ar/invoices/${id}`,
  cancelInvoice: (id: string) => `/ar/invoices/${id}/cancel`,
};

async function mercury<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const key = need("MERCURY_API_KEY", "Mercury");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Mercury ${res.status}: ${text}`);
  return text ? JSON.parse(text) : ({} as T);
}

export interface MercuryAccount { id: string; name: string; availableBalance: number; currentBalance: number; kind: string; status: string; accountNumber?: string }

export async function listAccounts(): Promise<MercuryAccount[]> {
  const data = await mercury<{ accounts: MercuryAccount[] }>(MERCURY_PATHS.accounts);
  return data.accounts ?? [];
}

export interface MercuryTxn {
  id: string;
  amount: number;
  status: string;
  kind: string;
  counterpartyName?: string;
  bankDescription?: string;
  note?: string;
  externalMemo?: string;
  postedAt?: string | null;
  createdAt: string;
}

export async function listTransactions(accountId: string, opts: { start?: string; end?: string; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams();
  qs.set("limit", String(opts.limit ?? 500));
  if (opts.offset) qs.set("offset", String(opts.offset));
  if (opts.start) qs.set("start", opts.start);
  if (opts.end) qs.set("end", opts.end);
  const data = await mercury<{ transactions: MercuryTxn[]; total: number }>(`${MERCURY_PATHS.transactions(accountId)}?${qs}`);
  return data.transactions ?? [];
}

export async function createCustomer(input: { name: string; email: string; address?: Record<string, string> }) {
  return mercury<{ id: string }>(MERCURY_PATHS.customers, { method: "POST", body: JSON.stringify(input) });
}

export async function findCustomerByEmail(email: string): Promise<{ id: string } | null> {
  try {
    const data = await mercury<{ customers?: { id: string; email: string }[] } | { id: string; email: string }[]>(MERCURY_PATHS.customers);
    const list = Array.isArray(data) ? data : data.customers ?? [];
    return list.find((c) => c.email?.toLowerCase() === email.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

export interface CreateInvoiceInput {
  customerId: string;
  invoiceNumber: string;       // idempotency: Mercury rejects duplicates
  invoiceDate: string;         // YYYY-MM-DD
  dueDate: string;             // YYYY-MM-DD
  lineItems: { name: string; unitPrice: number; quantity: number }[];
  payerMemo?: string;
  ccEmails?: string[];
  sendEmailOption?: "SendNow" | "DontSend";
  destinationAccountId?: string;
}

export interface MercuryInvoice { id: string; status: string; slug?: string; invoiceNumber?: string; amount?: number; paymentLink?: string; url?: string }

export async function createInvoice(input: CreateInvoiceInput): Promise<MercuryInvoice> {
  return mercury<MercuryInvoice>(MERCURY_PATHS.invoices, {
    method: "POST",
    body: JSON.stringify({
      customerId: input.customerId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      lineItems: input.lineItems,
      payerMemo: input.payerMemo,
      ccEmails: input.ccEmails ?? [],
      sendEmailOption: input.sendEmailOption ?? "SendNow",
      creditCardEnabled: true,
      achDebitEnabled: true,
      useRealAccountNumber: false,
      destinationAccountId: input.destinationAccountId || process.env.MERCURY_ACCOUNT_ID,
    }),
  });
}

export async function getInvoice(id: string): Promise<MercuryInvoice> {
  return mercury<MercuryInvoice>(MERCURY_PATHS.invoice(id));
}

export async function cancelInvoice(id: string) {
  return mercury(MERCURY_PATHS.cancelInvoice(id), { method: "POST" });
}

/** Normalize Mercury invoice status strings to ours. */
export function mapInvoiceStatus(s?: string): "sent" | "paid" | "void" | "overdue" | null {
  const v = (s || "").toLowerCase();
  if (v.includes("paid") && !v.includes("unpaid")) return "paid";
  if (v.includes("cancel") || v.includes("void")) return "void";
  if (v.includes("overdue")) return "overdue";
  if (v.includes("unpaid") || v.includes("open") || v.includes("sent") || v.includes("processing")) return "sent";
  return null;
}

export function invoicePaymentUrl(inv: MercuryInvoice) {
  return inv.paymentLink || inv.url || (inv.slug ? `https://app.mercury.com/pay/${inv.slug}` : null);
}
