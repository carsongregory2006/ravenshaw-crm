"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Banknote, Plus, Settings2, Undo2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/misc";
import { StatusTag, Tag } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  addCommissionAdjustment, approveCommissions, clawbackCommission, createPayout, deletePayout, setCommissionStatus,
} from "@/lib/actions/finance";
import type { ActionResult } from "@/lib/actions/util";
import { fmtDate, money, pct } from "@/lib/utils";
import { CsvButton } from "./csv";

export interface LedgerRow {
  id: string; created_at: string; rep_id: string; rep_name: string; client_name: string | null; deal_id: string | null; deal_number: string | null;
  basis: string; base_amount: number; rate: number; amount: number; status: string; note: string | null; payout_id: string | null; in_period: boolean;
}
export interface PayoutRow { id: string; rep_id: string; rep_name: string; amount: number; paid_at: string; method: string | null; note: string | null; count: number }
export interface RepRow { id: string; name: string; rate_setup: number; rate_recurring: number; recurring_months: number | null }

const BASIS: Record<string, string> = { one_time: "Setup / one-time", recurring: "Recurring", milestone: "Milestone" };

export function CommissionsView({ rows, payouts, reps, isAdmin, isStaff }: { rows: LedgerRow[]; payouts: PayoutRow[]; reps: RepRow[]; isAdmin: boolean; isStaff: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState("ledger");
  const [rep, setRep] = useState("");
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [payout, setPayout] = useState<{ repId: string; method: string; note: string; paidAt: string } | null>(null);
  const [claw, setClaw] = useState<{ id: string; note: string } | null>(null);
  const [adj, setAdj] = useState<{ repId: string; amount: string; note: string } | null>(null);

  const run = <T,>(fn: () => Promise<ActionResult<T>>, ok: string | ((d: T) => string), after?: () => void) => start(async () => {
    const r = await fn();
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(typeof ok === "function" ? ok(r.data) : ok);
    after?.();
    router.refresh();
  });

  const filtered = rows.filter((r) => r.in_period && (!rep || r.rep_id === rep) && (!status || r.status === status));
  const selectedRows = rows.filter((r) => sel.has(r.id));

  const cards = useMemo(() => {
    const ids = [...new Set([...reps.map((r) => r.id), ...rows.map((r) => r.rep_id)])];
    return ids.map((id) => {
      const mine = rows.filter((r) => r.rep_id === id);
      const s = (st: string) => mine.filter((r) => r.status === st).reduce((a, r) => a + r.amount, 0);
      return {
        id, name: reps.find((r) => r.id === id)?.name ?? mine[0]?.rep_name ?? "Rep",
        earned: mine.filter((r) => r.in_period && r.status !== "clawed_back").reduce((a, r) => a + r.amount, 0),
        pending: s("pending"), approved: s("approved"), paid: s("paid"), outstanding: s("pending") + s("approved"),
      };
    }).filter((c) => c.earned || c.outstanding || c.paid || reps.some((r) => r.id === c.id));
  }, [rows, reps]);

  // payout candidates: selected approved rows for the rep, else all approved for the rep
  const payoutIds = (repId: string) => {
    const chosen = selectedRows.filter((r) => r.rep_id === repId && r.status === "approved");
    return (chosen.length ? chosen : rows.filter((r) => r.rep_id === repId && r.status === "approved")).map((r) => r.id);
  };
  const payoutAmount = payout ? rows.filter((r) => payoutIds(payout.repId).includes(r.id)).reduce((a, r) => a + r.amount, 0) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-1 gap-3 border-b border-border p-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.length === 0 && <p className="text-[13px] text-fg-3">No commissions yet. They accrue automatically when client payments land in Mercury.</p>}
        {cards.map((c) => (
          <button key={c.id} onClick={() => setRep(rep === c.id ? "" : c.id)}
            className={`rounded-lg border p-3 text-left transition-colors cursor-pointer ${rep === c.id ? "border-accent bg-accent-soft/40" : "border-border hover:bg-hover"}`}>
            <div className="flex items-center gap-2"><Avatar name={c.name} size={20} /><span className="truncate text-[13px] font-medium">{c.name}</span></div>
            <div className="mt-2 text-lg font-semibold">{money(c.earned, { cents: true })}<span className="ml-1 text-xs font-normal text-fg-3">earned in period</span></div>
            <div className="mt-1 grid grid-cols-3 gap-1 text-xs text-fg-3">
              <span>Pending<br /><b className="text-fg">{money(c.pending)}</b></span>
              <span>Approved<br /><b className="text-fg">{money(c.approved)}</b></span>
              <span>Paid<br /><b className="text-fg">{money(c.paid)}</b></span>
            </div>
            <div className="mt-1 text-xs text-fg-3">Outstanding: <b className="text-fg">{money(c.outstanding, { cents: true })}</b></div>
          </button>
        ))}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: "ledger", label: "Ledger", count: filtered.length }, { id: "payouts", label: "Payouts", count: payouts.length }, ...(isStaff ? [{ id: "rates", label: "Rep rates" }] : [])]}
        right={tab === "ledger" ? <>
          <Select className="h-7 w-40" value={rep} onChange={(e) => setRep(e.target.value)}>
            <option value="">All reps</option>
            {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select className="h-7 w-32" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {["pending", "approved", "paid", "clawed_back"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </Select>
          <CsvButton filename="commission-ledger" rows={filtered.map((r) => ({ date: r.created_at.slice(0, 10), rep: r.rep_name, client: r.client_name, deal: r.deal_number, basis: r.basis, base_amount: r.base_amount, rate: r.rate, commission: r.amount, status: r.status, note: r.note }))} />
          {isAdmin && <Button size="sm" icon={Plus} onClick={() => setAdj({ repId: rep || reps[0]?.id || "", amount: "", note: "" })}>Adjustment</Button>}
          {isAdmin && <Button size="sm" variant="primary" icon={Banknote} onClick={() => setPayout({ repId: rep || selectedRows[0]?.rep_id || cards.find((c) => c.approved > 0)?.id || "", method: "ACH", note: "", paidAt: new Date().toISOString().slice(0, 10) })}>Record payout</Button>}
        </> : tab === "payouts" ? <CsvButton filename="commission-payouts" rows={payouts.map(({ id, rep_id, ...p }) => p)} /> : null} />

      {tab === "ledger" && (
        <>
          {isAdmin && sel.size > 0 && (
            <div className="flex items-center gap-2 border-b border-border-light bg-bg-2 px-3 py-1.5">
              <span className="text-xs text-fg-3">{sel.size} selected · {money(selectedRows.reduce((a, r) => a + r.amount, 0), { cents: true })}</span>
              <Button size="sm" icon={BadgeCheck} loading={pending} onClick={() => run(() => approveCommissions([...sel]), (n) => `Approved ${n} commission(s)`, () => setSel(new Set()))}>Approve</Button>
              <Button size="sm" icon={RotateCcw} onClick={() => run(() => setCommissionStatus([...sel], "pending"), "Moved back to pending", () => setSel(new Set()))}>Back to pending</Button>
            </div>
          )}
          <DataTable className="flex-1" rows={filtered} selectable={isAdmin} selected={sel} onSelectedChange={setSel}
            empty={<EmptyState icon={Banknote} title="No commissions in this view" description="Commissions accrue when a client payment is recorded, using each rep's rates from Settings → Team." />}
            columns={[
              { id: "date", header: "Date", width: 104, sortValue: (r) => r.created_at, cell: (r) => fmtDate(r.created_at) },
              { id: "rep", header: "Rep", sortValue: (r) => r.rep_name, cell: (r) => <span className="inline-flex items-center gap-1.5"><Avatar name={r.rep_name} size={16} />{r.rep_name}</span> },
              { id: "client", header: "Client", sortValue: (r) => r.client_name ?? "", cell: (r) => r.client_name ?? "—" },
              { id: "deal", header: "Deal", width: 96, cell: (r) => (r.deal_id ? <Link className="font-mono text-xs hover:underline" href={`/deals/${r.deal_id}`}>{r.deal_number}</Link> : "—") },
              { id: "basis", header: "Basis", cell: (r) => (r.note?.startsWith("Adjustment") ? <Tag color="purple">Adjustment</Tag> : <span className="text-fg-2">{BASIS[r.basis] ?? r.basis}</span>) },
              { id: "base", header: "Base", align: "right", sortValue: (r) => r.base_amount, cell: (r) => money(r.base_amount, { cents: true }) },
              { id: "rate", header: "Rate", align: "right", width: 64, cell: (r) => (r.note?.startsWith("Adjustment") ? "—" : pct(r.rate, 1)) },
              { id: "amount", header: "Commission", align: "right", sortValue: (r) => r.amount, cell: (r) => <b>{money(r.amount, { cents: true })}</b> },
              { id: "status", header: "Status", width: 100, sortValue: (r) => r.status, cell: (r) => <span title={r.note ?? undefined}><StatusTag status={r.status} /></span> },
              ...(isAdmin ? [{
                id: "x", header: "", width: 40, cell: (r: LedgerRow) => r.status !== "clawed_back" && r.status !== "paid" ? (
                  <span onClick={(e) => e.stopPropagation()}><Button size="xs" variant="ghost" icon={Undo2} title="Claw back" aria-label="Claw back" onClick={() => setClaw({ id: r.id, note: "" })} /></span>
                ) : null,
              }] : []),
            ]} />
        </>
      )}

      {tab === "payouts" && (
        <DataTable className="flex-1" rows={payouts} empty={<EmptyState icon={Banknote} title="No payouts recorded" />}
          columns={[
            { id: "date", header: "Paid", width: 110, sortValue: (r) => r.paid_at, cell: (r) => fmtDate(r.paid_at) },
            { id: "rep", header: "Rep", sortValue: (r) => r.rep_name, cell: (r) => r.rep_name },
            { id: "count", header: "Commissions", align: "right", cell: (r) => r.count },
            { id: "method", header: "Method", cell: (r) => r.method ?? "—" },
            { id: "note", header: "Note", cell: (r) => <span className="text-fg-2">{r.note ?? ""}</span> },
            { id: "amount", header: "Amount", align: "right", sortValue: (r) => r.amount, cell: (r) => <b>{money(r.amount, { cents: true })}</b> },
            ...(isAdmin ? [{ id: "x", header: "", width: 40, cell: (r: PayoutRow) => (
              <Button size="xs" variant="ghost" icon={Trash2} title="Delete payout (commissions return to Approved)" aria-label="Delete payout"
                onClick={() => confirm("Delete this payout? Its commissions go back to Approved.") && run(() => deletePayout(r.id), "Payout deleted")} />
            ) }] : []),
          ]} />
      )}

      {tab === "rates" && (
        <div className="flex-1 overflow-auto">
          <DataTable rows={reps} empty={<EmptyState title="No team members" />} columns={[
            { id: "name", header: "Rep", cell: (r) => r.name },
            { id: "setup", header: "Setup / one-time rate", align: "right", cell: (r) => pct(r.rate_setup, 1) },
            { id: "rec", header: "Recurring rate", align: "right", cell: (r) => pct(r.rate_recurring, 1) },
            { id: "months", header: "Recurring paid for", align: "right", cell: (r) => (r.recurring_months ? `${r.recurring_months} months` : "Life of client") },
          ]} />
          {isAdmin && <div className="p-3"><Link href="/settings?tab=team"><Button icon={Settings2}>Edit rates in Settings → Team</Button></Link></div>}
        </div>
      )}

      <Dialog open={!!payout} onOpenChange={(o) => !o && setPayout(null)} title="Record commission payout" size="sm"
        description="Marks approved commissions as paid and logs the payout. Pay the rep from Mercury separately."
        footer={<><Button onClick={() => setPayout(null)}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={!payout?.repId || payoutAmount <= 0}
            onClick={() => payout && run(() => createPayout({ repId: payout.repId, commissionIds: payoutIds(payout.repId), method: payout.method, note: payout.note, paidAt: payout.paidAt }), (d) => `Payout of ${money(d.amount, { cents: true })} recorded`, () => { setPayout(null); setSel(new Set()); })}>
            Pay {money(payoutAmount, { cents: true })}
          </Button></>}>
        {payout && (
          <div className="space-y-3">
            <Field label="Rep">
              <Select value={payout.repId} onChange={(e) => setPayout({ ...payout, repId: e.target.value })}>
                <option value="">Select…</option>
                {cards.map((c) => <option key={c.id} value={c.id}>{c.name} — {money(c.approved)} approved</option>)}
              </Select>
            </Field>
            <p className="text-xs text-fg-3">{payoutIds(payout.repId).length} approved commission(s){selectedRows.some((r) => r.rep_id === payout.repId && r.status === "approved") ? " from your selection" : ""}. Pending ones must be approved first.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid on"><Input type="date" value={payout.paidAt} onChange={(e) => setPayout({ ...payout, paidAt: e.target.value })} /></Field>
              <Field label="Method">
                <Select value={payout.method} onChange={(e) => setPayout({ ...payout, method: e.target.value })}>
                  {["ACH", "Wire", "Payroll", "Check", "Other"].map((m) => <option key={m}>{m}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Note"><Input value={payout.note} onChange={(e) => setPayout({ ...payout, note: e.target.value })} placeholder="e.g. October payout" /></Field>
          </div>
        )}
      </Dialog>

      <Dialog open={!!claw} onOpenChange={(o) => !o && setClaw(null)} title="Claw back commission" size="sm"
        footer={<><Button onClick={() => setClaw(null)}>Cancel</Button><Button variant="danger" loading={pending} onClick={() => claw && run(() => clawbackCommission(claw.id, claw.note), "Commission clawed back", () => setClaw(null))}>Claw back</Button></>}>
        {claw && <Field label="Reason"><Textarea autoFocus value={claw.note} onChange={(e) => setClaw({ ...claw, note: e.target.value })} placeholder="e.g. Client refunded / chargeback" /></Field>}
      </Dialog>

      <Dialog open={!!adj} onOpenChange={(o) => !o && setAdj(null)} title="Manual commission adjustment" size="sm" description="Bonuses, spiffs, or corrections (use a negative amount to deduct). Added as Approved."
        footer={<><Button onClick={() => setAdj(null)}>Cancel</Button><Button variant="primary" loading={pending} onClick={() => adj && run(() => addCommissionAdjustment({ repId: adj.repId, amount: Number(adj.amount), note: adj.note }), "Adjustment added", () => setAdj(null))}>Add</Button></>}>
        {adj && (
          <div className="space-y-3">
            <Field label="Rep">
              <Select value={adj.repId} onChange={(e) => setAdj({ ...adj, repId: e.target.value })}>
                <option value="">Select…</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label="Amount ($)"><Input type="number" step="0.01" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></Field>
            <Field label="Note"><Input value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} placeholder="e.g. Q3 quota bonus" /></Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
