"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, RefreshCw, Search } from "lucide-react";
import { startOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Card, Stat } from "@/components/ui/misc";
import { PageBody } from "@/components/ui/page";
import { cn, money, timeAgo } from "@/lib/utils";
import { syncStripeNow } from "@/lib/actions/billing";
import { InvoiceTable, CreateInvoiceDialog } from "./invoice-ui";
import type { Invoice } from "@/lib/types";

export type InvoiceListRow = Invoice & { contact_name?: string; deal_number?: string };
type ClientOption = { id: string; contactId: string; dealId: string | null; label: string };

const STATUSES = ["all", "sent", "overdue", "paid", "error", "draft", "void"];

export function InvoicesView({ rows, clients, lastSync, stripeConfigured, initialStatus }: {
  rows: InvoiceListRow[]; clients: ClientOption[]; lastSync: string | null; stripeConfigured: boolean; initialStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(STATUSES.includes(initialStatus) ? initialStatus : "all");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [billing, setBilling] = useState<ClientOption | null>(null);

  const filtered = rows.filter((r) =>
    (status === "all" || r.status === status) && (kind === "all" || r.kind === kind) &&
    (!q || `${r.invoice_number} ${r.contact_name ?? ""} ${r.deal_number ?? ""} ${r.description ?? ""}`.toLowerCase().includes(q.toLowerCase())));

  const sumOf = (xs: InvoiceListRow[]) => xs.reduce((a, r) => a + Number(r.amount), 0);
  const outstanding = rows.filter((r) => r.status === "sent" || r.status === "overdue");
  const overdue = rows.filter((r) => r.status === "overdue");
  const som = startOfMonth(new Date());
  const paidMonth = rows.filter((r) => r.status === "paid" && r.paid_at && new Date(r.paid_at) >= som);
  const failed = rows.filter((r) => r.status === "error");

  const sync = async () => {
    setSyncing(true);
    const r = await syncStripeNow();
    setSyncing(false);
    if (!r.ok) return toast.error(r.error);
    const s = r.data;
    if (s.errors.length) toast.warning(`Synced with issues: ${s.errors[0]}`);
    else toast.success(`Stripe synced · ${s.checked} open invoices checked, ${s.invoicesPaid} newly paid`);
    router.refresh();
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-3 md:grid-cols-4">
        <Stat label="Outstanding" value={money(sumOf(outstanding))} sub={`${outstanding.length} open invoice${outstanding.length === 1 ? "" : "s"}`} />
        <Stat label="Overdue" value={<span className={overdue.length ? "text-danger" : undefined}>{money(sumOf(overdue))}</span>} sub={`${overdue.length} invoice${overdue.length === 1 ? "" : "s"}`} />
        <Stat label="Collected this month" value={money(sumOf(paidMonth))} sub={`${paidMonth.length} paid`} />
        <Stat label="Failed to send" value={failed.length} sub={failed.length ? "retry from the row menu" : "all good"} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-0.5">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={cn("h-7 rounded-md px-2 text-[13px] capitalize cursor-pointer", status === s ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover hover:text-fg")}>
              {s}<span className="ml-1 text-xs text-fg-4">{s === "all" ? rows.length : rows.filter((r) => r.status === s).length}</span>
            </button>
          ))}
        </div>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-7 w-36">
          <option value="all">All types</option><option value="one_time">One-time</option><option value="recurring">Recurring</option><option value="milestone">Milestone</option>
        </Select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-4" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoices" className="h-7 w-48 pl-7" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-fg-3">{stripeConfigured ? (lastSync ? `Stripe synced ${timeAgo(lastSync)}` : "Stripe not synced yet") : "Stripe not configured"}</span>
          <Button size="sm" icon={RefreshCw} loading={syncing} onClick={sync} disabled={!stripeConfigured}>Sync Stripe now</Button>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setPicking(true)}>New invoice</Button>
        </div>
      </div>
      <PageBody className="p-3">
        <Card padded={false}>
          <InvoiceTable invoices={filtered} canManage showContact onChange={() => router.refresh()} />
        </Card>
      </PageBody>

      <PickClientDialog open={picking} clients={clients} onClose={() => setPicking(false)} onPick={(c) => { setPicking(false); setBilling(c); }} />
      {billing && (
        <CreateInvoiceDialog open onClose={() => setBilling(null)} contactId={billing.contactId} clientId={billing.id} dealId={billing.dealId} onDone={() => router.refresh()} />
      )}
    </>
  );
}

function PickClientDialog({ open, clients, onClose, onPick }: { open: boolean; clients: ClientOption[]; onClose: () => void; onPick: (c: ClientOption) => void }) {
  const [id, setId] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="New invoice" description="Choose the client to bill. To invoice a prospect before signing, use the Billing panel on their deal." size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!id} onClick={() => { const c = clients.find((x) => x.id === id); if (c) onPick(c); }}>Continue</Button></>}>
      <Field label="Client">
        <Select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Select a client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </Field>
      {!clients.length && <p className="mt-2 text-xs text-fg-3">No active clients yet.</p>}
    </Dialog>
  );
}
