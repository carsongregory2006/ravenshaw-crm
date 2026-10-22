"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { safe } from "@/lib/actions/util";
import { logActivity } from "@/lib/activity";
import { sendContractForDeal, resendContract as resendContractLib, refreshContractStatus } from "@/lib/billing/contracts";
import { onContractSigned } from "@/lib/billing/onboarding";
import { issueInvoice, retryInvoice as retryInvoiceLib, voidInvoice as voidInvoiceLib, getInvoiceLines, type InvoiceItem } from "@/lib/billing/invoices";
import { markInvoicePaidManually } from "@/lib/billing/payments";
import { syncMercury } from "@/lib/billing/mercury-sync";
import type {
  BillingSchedule, Client, Contact, Contract, Deal, DealLineItem, Invoice, Payment, Profile,
} from "@/lib/types";

async function staff() {
  const p = await requireProfile();
  if (p.role !== "admin" && p.role !== "ops") throw new Error("Only admins and ops can manage billing");
  return p;
}

/** Throws unless the current user can see the deal under RLS. */
async function assertDealAccess(dealId: string) {
  const sb = await createClient();
  const { data } = await sb.from("deals").select("id").eq("id", dealId).maybeSingle();
  if (!data) throw new Error("Deal not found or access denied");
}

function refresh(dealId?: string | null, clientId?: string | null) {
  if (dealId) revalidatePath(`/deals/${dealId}`);
  if (clientId) revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/onboarding");
  revalidatePath("/finance/invoices");
}

export type InvoiceWithLines = Invoice & { lines: InvoiceItem[] };

export interface DealBillingData {
  deal: Deal & { contact: Pick<Contact, "id" | "first_name" | "last_name" | "email"> | null };
  lineItems: DealLineItem[];
  contracts: Contract[];
  invoices: InvoiceWithLines[];
  schedules: BillingSchedule[];
  payments: Payment[];
  clientId: string | null;
  canManage: boolean;
  isAdmin: boolean;
}

export async function getDealBilling(dealId: string) {
  return safe(async (): Promise<DealBillingData> => {
    const me = await requireProfile();
    const sb = await createClient();
    const [{ data: deal }, { data: lineItems }, { data: contracts }, { data: invoices }] = await Promise.all([
      sb.from("deals").select("*, contact:contacts(id, first_name, last_name, email)").eq("id", dealId).single(),
      sb.from("deal_line_items").select("*").eq("deal_id", dealId).order("position"),
      sb.from("contracts").select("*").eq("deal_id", dealId).order("created_at", { ascending: false }),
      sb.from("invoices").select("*").eq("deal_id", dealId).order("created_at", { ascending: false }),
    ]);
    if (!deal) throw new Error("Deal not found");
    const canManage = me.role === "admin" || me.role === "ops";
    const db = createAdminClient();
    const [{ data: schedules }, { data: payments }, { data: client }] = await Promise.all([
      canManage ? db.from("billing_schedules").select("*").eq("deal_id", dealId).order("next_invoice_date") : Promise.resolve({ data: [] }),
      canManage ? db.from("payments").select("*").eq("deal_id", dealId).order("received_at", { ascending: false }) : Promise.resolve({ data: [] }),
      db.from("clients").select("id").eq("deal_id", dealId).maybeSingle(),
    ]);
    const withLines = await Promise.all(((invoices ?? []) as Invoice[]).map(async (i) => ({ ...i, lines: await getInvoiceLines(i.id) })));
    return {
      deal: deal as DealBillingData["deal"],
      lineItems: (lineItems ?? []) as DealLineItem[],
      contracts: (contracts ?? []) as Contract[],
      invoices: withLines,
      schedules: (schedules ?? []) as BillingSchedule[],
      payments: (payments ?? []) as Payment[],
      clientId: client?.id ?? null,
      canManage,
      isAdmin: me.role === "admin",
    };
  });
}

// ───────── Contracts ─────────
export async function sendContract(dealId: string) {
  return safe(async () => {
    const me = await requireProfile();
    await assertDealAccess(dealId);
    const c = await sendContractForDeal(dealId, me.id);
    refresh(dealId);
    return c;
  });
}

export async function resendContract(contractId: string) {
  return safe(async () => {
    const me = await requireProfile();
    const sb = await createClient();
    const { data: c } = await sb.from("contracts").select("deal_id").eq("id", contractId).maybeSingle();
    if (!c) throw new Error("Contract not found");
    await resendContractLib(contractId, me.id);
    refresh(c.deal_id);
  });
}

export async function refreshContract(contractId: string) {
  return safe(async () => {
    await requireProfile();
    const sb = await createClient();
    const { data: c } = await sb.from("contracts").select("deal_id").eq("id", contractId).maybeSingle();
    if (!c) throw new Error("Contract not found");
    const updated = await refreshContractStatus(contractId);
    refresh(c.deal_id);
    return updated;
  });
}

/** Admin override when a client signed outside PandaDoc (or the webhook was missed). Runs the full won flow. */
export async function markContractSigned(contractId: string) {
  return safe(async () => {
    const me = await requireProfile();
    if (me.role !== "admin") throw new Error("Only admins can mark contracts as signed");
    const db = createAdminClient();
    const { data: c } = await db.from("contracts").select("deal_id, contact_id").eq("id", contractId).single();
    await db.from("contracts").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", contractId);
    await logActivity({ type: "contract", title: "Contract manually marked as signed", deal_id: c?.deal_id, contact_id: c?.contact_id, actor_id: me.id });
    const res = await onContractSigned(contractId);
    refresh(c?.deal_id, "clientId" in res ? res.clientId : null);
    return res;
  });
}

/** Admin: close a deal as won without a PandaDoc contract (creates a placeholder contract record so the flow is auditable). */
export async function markDealWonWithoutContract(dealId: string) {
  return safe(async () => {
    const me = await requireProfile();
    if (me.role !== "admin") throw new Error("Only admins can do this");
    const db = createAdminClient();
    const { data: deal } = await db.from("deals").select("contact_id, deal_number").eq("id", dealId).single();
    const { data: c } = await db.from("contracts").insert({
      deal_id: dealId, contact_id: deal?.contact_id, name: `${deal?.deal_number} — signed offline`, status: "completed",
      completed_at: new Date().toISOString(), created_by: me.id,
    }).select("id").single();
    const res = await onContractSigned(c!.id);
    refresh(dealId, "clientId" in res ? res.clientId : null);
    return res;
  });
}

// ───────── Invoices ─────────
export async function createInvoiceAction(input: { dealId?: string | null; clientId?: string | null; contactId: string; items: InvoiceItem[]; dueDays?: number; description?: string }) {
  return safe(async () => {
    const me = await staff();
    const inv = await issueInvoice({ ...input, actorId: me.id });
    refresh(input.dealId, inv.client_id ?? input.clientId);
    return inv;
  });
}

export async function retryInvoice(invoiceId: string) {
  return safe(async () => {
    await staff();
    const inv = await retryInvoiceLib(invoiceId);
    refresh(inv.deal_id, inv.client_id);
    return inv;
  });
}

export async function voidInvoice(invoiceId: string) {
  return safe(async () => {
    const me = await staff();
    const { data: inv } = await createAdminClient().from("invoices").select("deal_id, client_id").eq("id", invoiceId).single();
    await voidInvoiceLib(invoiceId, me.id);
    refresh(inv?.deal_id, inv?.client_id);
  });
}

export async function markInvoicePaid(invoiceId: string, opts: { amount?: number; date?: string; note?: string; method?: string }) {
  return safe(async () => {
    const me = await staff();
    const { data: inv } = await createAdminClient().from("invoices").select("deal_id, client_id").eq("id", invoiceId).single();
    const p = await markInvoicePaidManually(invoiceId, { ...opts, actorId: me.id });
    refresh(inv?.deal_id, inv?.client_id);
    revalidatePath("/finance/commissions");
    return p;
  });
}

export async function syncMercuryNow() {
  return safe(async () => {
    await staff();
    const s = await syncMercury();
    revalidatePath("/finance/invoices");
    revalidatePath("/finance");
    revalidatePath("/finance/expenses");
    return s;
  });
}

// ───────── Billing schedules ─────────
export async function updateSchedule(id: string, patch: { active?: boolean; next_invoice_date?: string; amount?: number; cycles_remaining?: number | null }) {
  return safe(async () => {
    await staff();
    const { data } = await createAdminClient().from("billing_schedules").update(patch).eq("id", id).select("deal_id, client_id").single();
    refresh(data?.deal_id, data?.client_id);
  });
}

export async function deleteSchedule(id: string) {
  return safe(async () => {
    await staff();
    const { data } = await createAdminClient().from("billing_schedules").delete().eq("id", id).select("deal_id, client_id").single();
    refresh(data?.deal_id, data?.client_id);
  });
}

export async function createSchedule(input: { clientId: string; description: string; amount: number; intervalMonths: number; nextDate: string; cycles?: number | null }) {
  return safe(async () => {
    await staff();
    const db = createAdminClient();
    const { data: client } = await db.from("clients").select("deal_id").eq("id", input.clientId).single();
    await db.from("billing_schedules").insert({
      client_id: input.clientId, deal_id: client?.deal_id ?? null, description: input.description, amount: input.amount,
      interval_months: input.intervalMonths, next_invoice_date: input.nextDate, cycles_remaining: input.cycles ?? null,
    });
    refresh(client?.deal_id, input.clientId);
  });
}

// ───────── Clients ─────────
export async function updateClient(clientId: string, patch: Partial<Pick<Client, "health_score" | "account_manager_id" | "mrr" | "start_date">>) {
  return safe(async () => {
    await staff();
    const sb = await createClient();
    const { error } = await sb.from("clients").update(patch).eq("id", clientId);
    if (error) throw new Error(error.message);
    refresh(null, clientId);
  });
}

export async function setClientStatus(clientId: string, status: Client["status"], reason?: string) {
  return safe(async () => {
    const me = await staff();
    const db = createAdminClient();
    const { data: client } = await db.from("clients").select("*").eq("id", clientId).single();
    if (!client) throw new Error("Client not found");
    const patch: Record<string, unknown> = { status };
    if (status === "churned") { patch.churned_at = new Date().toISOString(); patch.churn_reason = reason ?? null; }
    if (status === "active" || status === "onboarding") { patch.churned_at = null; patch.churn_reason = null; }
    await db.from("clients").update(patch).eq("id", clientId);
    // Pausing/churning stops future invoices; reactivating resumes them.
    if (status === "churned") {
      await db.from("billing_schedules").update({ active: false }).eq("client_id", clientId);
      await db.from("contacts").update({ status: "churned" }).eq("id", client.contact_id);
    }
    if ((status === "active" || status === "onboarding") && client.status === "churned") {
      await db.from("contacts").update({ status: "client" }).eq("id", client.contact_id);
    }
    await logActivity({
      type: "system", title: `Client status → ${status}`, body: reason ?? null, client_id: clientId, contact_id: client.contact_id, actor_id: me.id,
    });
    refresh(client.deal_id, clientId);
  });
}

export async function resumeClientBilling(clientId: string) {
  return safe(async () => {
    await staff();
    await createAdminClient().from("billing_schedules").update({ active: true }).eq("client_id", clientId).or("cycles_remaining.is.null,cycles_remaining.gt.0");
    refresh(null, clientId);
  });
}

// ───────── Onboarding steps ─────────
async function stepClient(stepId: string) {
  const sb = await createClient();
  const { data } = await sb.from("onboarding_steps").select("client_id").eq("id", stepId).maybeSingle();
  if (!data) throw new Error("Step not found");
  return data.client_id as string;
}

export async function toggleStep(stepId: string, done: boolean) {
  return safe(async () => {
    const me = await requireProfile();
    const clientId = await stepClient(stepId);
    const sb = await createClient();
    const { data: step } = await sb.from("onboarding_steps").update({ completed_at: done ? new Date().toISOString() : null, completed_by: done ? me.id : null })
      .eq("id", stepId).select("title").single();
    if (done && step) {
      const db = createAdminClient();
      const { data: c } = await db.from("clients").select("contact_id").eq("id", clientId).single();
      await logActivity({ type: "task", title: `Onboarding: ${step.title} ✓`, client_id: clientId, contact_id: c?.contact_id, actor_id: me.id });
    }
    refresh(null, clientId);
  });
}

export async function addStep(clientId: string, input: { title: string; due_date?: string | null; assignee_id?: string | null; description?: string | null }) {
  return safe(async () => {
    await requireProfile();
    if (!input.title.trim()) throw new Error("Title is required");
    const sb = await createClient();
    const { count } = await sb.from("onboarding_steps").select("id", { count: "exact", head: true }).eq("client_id", clientId);
    const { error } = await sb.from("onboarding_steps").insert({ client_id: clientId, position: count ?? 0, ...input, title: input.title.trim() });
    if (error) throw new Error(error.message);
    refresh(null, clientId);
  });
}

export async function updateStep(stepId: string, patch: { title?: string; due_date?: string | null; assignee_id?: string | null; description?: string | null }) {
  return safe(async () => {
    await requireProfile();
    const clientId = await stepClient(stepId);
    const sb = await createClient();
    const { error } = await sb.from("onboarding_steps").update(patch).eq("id", stepId);
    if (error) throw new Error(error.message);
    refresh(null, clientId);
  });
}

export async function deleteStep(stepId: string) {
  return safe(async () => {
    await requireProfile();
    const clientId = await stepClient(stepId);
    const sb = await createClient();
    await sb.from("onboarding_steps").delete().eq("id", stepId);
    refresh(null, clientId);
  });
}

/** Moves an onboarding client to active (from the onboarding board). */
export async function completeOnboarding(clientId: string) {
  return setClientStatus(clientId, "active", "Onboarding complete");
}

export async function listTeam() {
  return safe(async () => {
    await requireProfile();
    const sb = await createClient();
    const { data } = await sb.from("profiles").select("id, full_name, email, avatar_url, role, is_active").eq("is_active", true).order("full_name");
    return (data ?? []) as Pick<Profile, "id" | "full_name" | "email" | "avatar_url" | "role" | "is_active">[];
  });
}
