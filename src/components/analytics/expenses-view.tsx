"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Eye, Pencil, Plus, Tags, Trash2, Wand2, Search } from "lucide-react";
import { toast } from "sonner";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/misc";
import { Tag } from "@/components/ui/badge";
import {
  applyRulesToPast, categorizeTransactions, createExpense, deleteExpenses, deleteRule, recategorizeExpenses, saveRule, setTransactionsIgnored, updateExpense,
} from "@/lib/actions/finance";
import { fmtDate, money } from "@/lib/utils";
import { CsvButton } from "./csv";
import type { ActionResult } from "@/lib/actions/util";

export interface ExpenseItem { id: string; date: string; amount: number; vendor: string | null; description: string | null; pl_class: string; category: string | null; recurring: boolean; client_id: string | null; mercury_transaction_id: string | null; client_name?: string | null }
export interface RuleItem { id: string; match: string; pl_class: string; category: string | null }
export interface TxnItem { id: string; amount: number; counterparty_name: string | null; bank_description: string | null; posted_at: string | null; created_at: string | null; pl_class: string | null; category: string | null; matched_invoice_id: string | null; ignored: boolean; kind: string | null; status: string | null }

export const PL_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: "cogs", label: "COGS", color: "orange" },
  { value: "payroll", label: "Payroll", color: "purple" },
  { value: "marketing", label: "Marketing", color: "pink" },
  { value: "software", label: "Software", color: "sky" },
  { value: "opex", label: "Operating", color: "blue" },
  { value: "other", label: "Other", color: "gray" },
  { value: "tax", label: "Taxes", color: "red" },
  { value: "interest", label: "Interest", color: "yellow" },
  { value: "depreciation", label: "Depreciation", color: "turquoise" },
  { value: "amortization", label: "Amortization", color: "turquoise" },
  { value: "owner_draw", label: "Owner draw", color: "gray" },
  { value: "transfer", label: "Transfer (excluded)", color: "gray" },
];
const plLabel = (v: string | null) => PL_OPTIONS.find((o) => o.value === v);
const PlTag = ({ v }: { v: string | null }) => { const o = plLabel(v); return o ? <Tag color={o.color}>{o.label}</Tag> : <span className="text-fg-4">Uncategorized</span>; };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, ok: string | ((d: T) => string), after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(typeof ok === "function" ? ok(r.data) : ok);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

function PlSelect({ value, onChange, allowAll }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">All classes</option>}
      {PL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}

/** Pick a P&L class + category, then run. Used for bulk recategorize and categorizing bank transactions. */
function CategorizeDialog({ open, onClose, title, onSubmit, pending, initial }: {
  open: boolean; onClose: () => void; title: string; pending: boolean; onSubmit: (pl: string, cat: string) => void; initial?: { pl?: string; cat?: string };
}) {
  const [pl, setPl] = useState(initial?.pl ?? "opex");
  const [cat, setCat] = useState(initial?.cat ?? "");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title} size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={pending} onClick={() => onSubmit(pl, cat)}>Apply</Button></>}>
      <div className="space-y-3">
        <Field label="P&L class"><PlSelect value={pl} onChange={setPl} /></Field>
        <Field label="Category (optional)" hint="Free-form, e.g. Contractors, Ads, Hosting"><Input value={cat} onChange={(e) => setCat(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

// ─────────────────────────── Expenses tab ───────────────────────────
const blankExpense = () => ({ date: new Date().toISOString().slice(0, 10), amount: "", vendor: "", description: "", pl_class: "opex", category: "", recurring: false, client_id: "" });

function ExpensesTab({ rows, clients }: { rows: ExpenseItem[]; clients: { id: string; name: string }[] }) {
  const { pending, run } = useRun();
  const [cls, setCls] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<(ReturnType<typeof blankExpense> & { id?: string }) | null>(null);
  const [bulk, setBulk] = useState(false);

  const filtered = useMemo(() => rows.filter((r) =>
    (!cls || r.pl_class === cls) &&
    (!q || [r.vendor, r.description, r.category].some((v) => v?.toLowerCase().includes(q.toLowerCase())))), [rows, cls, q]);
  const total = filtered.reduce((s, r) => s + r.amount, 0);

  const save = () => {
    if (!form) return;
    const input = { ...form, amount: Number(form.amount), client_id: form.client_id || null };
    run(() => (form.id ? updateExpense(form.id, input) : createExpense(input)), form.id ? "Expense updated" : "Expense added", () => setForm(null));
  };
  const set = (k: string, v: unknown) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-light px-3 py-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-fg-4" />
          <Input className="pl-7" placeholder="Search vendor, description…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-44"><PlSelect value={cls} onChange={setCls} allowAll /></div>
        <span className="text-xs text-fg-3">{filtered.length} expenses · <b className="text-fg">{money(total, { cents: true })}</b></span>
        <div className="ml-auto flex items-center gap-1.5">
          {sel.size > 0 && <>
            <span className="text-xs text-fg-3">{sel.size} selected</span>
            <Button size="sm" icon={Tags} onClick={() => setBulk(true)}>Recategorize</Button>
            <Button size="sm" icon={Trash2} variant="ghost" onClick={() => confirm(`Delete ${sel.size} expense(s)?`) && run(() => deleteExpenses([...sel]), "Deleted", () => setSel(new Set()))}>Delete</Button>
          </>}
          <CsvButton filename="expenses" rows={filtered.map(({ id, client_id, mercury_transaction_id, ...r }) => r)} />
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setForm(blankExpense())}>Add expense</Button>
        </div>
      </div>
      <DataTable className="flex-1" rows={filtered} selectable selected={sel} onSelectedChange={setSel}
        onRowClick={(r) => setForm({ id: r.id, date: r.date, amount: String(r.amount), vendor: r.vendor ?? "", description: r.description ?? "", pl_class: r.pl_class, category: r.category ?? "", recurring: r.recurring, client_id: r.client_id ?? "" })}
        empty={<EmptyState icon={Tags} title="No expenses in this period" description="Add expenses manually or sync Mercury and categorize bank transactions." />}
        columns={[
          { id: "date", header: "Date", width: 110, sortValue: (r) => r.date, cell: (r) => fmtDate(r.date) },
          { id: "vendor", header: "Vendor", sortValue: (r) => r.vendor ?? "", cell: (r) => r.vendor ?? "—" },
          { id: "desc", header: "Description", cell: (r) => <span className="text-fg-2">{r.description ?? ""}</span> },
          { id: "class", header: "P&L class", width: 130, sortValue: (r) => r.pl_class, cell: (r) => <PlTag v={r.pl_class} /> },
          { id: "cat", header: "Category", sortValue: (r) => r.category ?? "", cell: (r) => r.category ?? "—" },
          { id: "client", header: "Client", cell: (r) => r.client_name ?? "—" },
          { id: "src", header: "Source", width: 90, cell: (r) => (r.mercury_transaction_id ? <Tag color="blue">Mercury</Tag> : <Tag>Manual</Tag>) },
          { id: "amount", header: "Amount", align: "right", width: 110, sortValue: (r) => r.amount, cell: (r) => money(r.amount, { cents: true }) },
        ]} />
      <CategorizeDialog open={bulk} onClose={() => setBulk(false)} title={`Recategorize ${sel.size} expense(s)`} pending={pending}
        onSubmit={(pl, cat) => run(() => recategorizeExpenses([...sel], pl, cat), (n) => `Updated ${n} expense(s)`, () => { setBulk(false); setSel(new Set()); })} />
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)} title={form?.id ? "Edit expense" : "Add expense"}
        footer={<>
          {form?.id && <Button variant="ghost" icon={Trash2} className="mr-auto text-danger" onClick={() => confirm("Delete this expense?") && run(() => deleteExpenses([form.id!]), "Deleted", () => setForm(null))}>Delete</Button>}
          <Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" loading={pending} onClick={save}>Save</Button>
        </>}>
        {form && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
            <Field label="Amount ($)"><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
            <Field label="Vendor"><Input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} /></Field>
            <Field label="P&L class"><PlSelect value={form.pl_class} onChange={(v) => set("pl_class", v)} /></Field>
            <Field label="Category"><Input value={form.category} onChange={(e) => set("category", e.target.value)} /></Field>
            <Field label="Client (for client-level margin)">
              <Select value={form.client_id} onChange={(e) => set("client_id", e.target.value)}>
                <option value="">None</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Description" className="col-span-2"><Textarea className="min-h-14" value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
            <label className="col-span-2 flex items-center gap-2 text-[13px]"><Checkbox checked={form.recurring} onChange={(e) => set("recurring", e.target.checked)} /> Recurring monthly expense</label>
          </div>
        )}
      </Dialog>
    </div>
  );
}

// ─────────────────────────── Rules tab ───────────────────────────
function RulesTab({ rules }: { rules: RuleItem[] }) {
  const { pending, run } = useRun();
  const [form, setForm] = useState<{ id?: string; match: string; pl_class: string; category: string } | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border-light px-3 py-2">
        <p className="text-xs text-fg-3">Rules auto-categorize Mercury transactions whose counterparty contains the match text.</p>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" icon={Wand2} loading={pending && !form} disabled={!rules.length} onClick={() => run(applyRulesToPast, (d) => `Applied: ${d.expenses} expenses, ${d.transactions} transactions updated`)}>Apply to past</Button>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setForm({ match: "", pl_class: "software", category: "" })}>Add rule</Button>
        </div>
      </div>
      <DataTable rows={rules} className="flex-1" onRowClick={(r) => setForm({ id: r.id, match: r.match, pl_class: r.pl_class, category: r.category ?? "" })}
        empty={<EmptyState icon={Wand2} title="No rules yet" description='Example: "Gusto" → Payroll, "OpenAI" → COGS / AI usage, "Meta Ads" → Marketing.' />}
        columns={[
          { id: "match", header: "When vendor contains", sortValue: (r) => r.match, cell: (r) => <span className="font-medium">{r.match}</span> },
          { id: "class", header: "P&L class", cell: (r) => <PlTag v={r.pl_class} /> },
          { id: "cat", header: "Category", cell: (r) => r.category ?? "—" },
          { id: "x", header: "", width: 70, cell: (r) => (
            <span className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
              <Button size="xs" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setForm({ id: r.id, match: r.match, pl_class: r.pl_class, category: r.category ?? "" })} />
              <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => confirm("Delete rule?") && run(() => deleteRule(r.id), "Rule deleted")} />
            </span>
          ) },
        ]} />
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)} title={form?.id ? "Edit rule" : "New categorization rule"} size="sm"
        footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" loading={pending} onClick={() => form && run(() => saveRule(form), "Rule saved", () => setForm(null))}>Save</Button></>}>
        {form && (
          <div className="space-y-3">
            <Field label="Vendor contains"><Input value={form.match} autoFocus onChange={(e) => setForm({ ...form, match: e.target.value })} placeholder="e.g. Gusto" /></Field>
            <Field label="P&L class"><PlSelect value={form.pl_class} onChange={(v) => setForm({ ...form, pl_class: v })} /></Field>
            <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}

// ─────────────────────────── Mercury review tab ───────────────────────────
const TXN_FILTERS = [
  { id: "uncat", label: "Uncategorized outflows" },
  { id: "unmatched", label: "Unmatched inflows" },
  { id: "ignored", label: "Ignored" },
  { id: "all", label: "All" },
];

function MercuryTab({ txns }: { txns: TxnItem[] }) {
  const { pending, run } = useRun();
  const [f, setF] = useState("uncat");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cat, setCat] = useState(false);
  const rows = txns.filter((t) =>
    f === "uncat" ? !t.ignored && t.amount < 0 && !t.pl_class :
    f === "unmatched" ? !t.ignored && t.amount > 0 && !t.matched_invoice_id && !t.pl_class :
    f === "ignored" ? t.ignored : true);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-light px-3 py-2">
        <div className="flex gap-1">
          {TXN_FILTERS.map((x) => (
            <Button key={x.id} size="sm" variant={f === x.id ? "tertiary" : "ghost"} onClick={() => { setF(x.id); setSel(new Set()); }}>{x.label}</Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {sel.size > 0 && <>
            <span className="text-xs text-fg-3">{sel.size} selected</span>
            <Button size="sm" icon={Tags} onClick={() => setCat(true)}>Categorize</Button>
            {f === "ignored"
              ? <Button size="sm" icon={Eye} onClick={() => run(() => setTransactionsIgnored([...sel], false), "Restored", () => setSel(new Set()))}>Un-ignore</Button>
              : <Button size="sm" icon={EyeOff} onClick={() => run(() => setTransactionsIgnored([...sel], true), "Ignored — excluded from reports", () => setSel(new Set()))}>Ignore</Button>}
          </>}
          <CsvButton filename="mercury-transactions" rows={rows.map((t) => ({ date: t.posted_at ?? t.created_at, counterparty: t.counterparty_name, description: t.bank_description, amount: t.amount, pl_class: t.pl_class, category: t.category, ignored: t.ignored }))} />
        </div>
      </div>
      <DataTable className="flex-1" rows={rows} selectable selected={sel} onSelectedChange={setSel}
        empty={<EmptyState icon={Tags} title="Nothing to review" description={txns.length ? "All transactions in this filter are handled." : "No Mercury transactions synced for this period yet. Use Sync Mercury on the P&L page."} />}
        columns={[
          { id: "date", header: "Date", width: 110, sortValue: (r) => r.posted_at ?? r.created_at ?? "", cell: (r) => fmtDate(r.posted_at ?? r.created_at) },
          { id: "cp", header: "Counterparty", sortValue: (r) => r.counterparty_name ?? "", cell: (r) => r.counterparty_name ?? "—" },
          { id: "desc", header: "Bank description", cell: (r) => <span className="text-fg-2">{r.bank_description ?? r.kind ?? ""}</span> },
          { id: "class", header: "P&L class", width: 130, cell: (r) => (r.amount > 0 && !r.pl_class ? (r.matched_invoice_id ? <Tag color="green">Invoice payment</Tag> : <span className="text-fg-4">Income</span>) : <PlTag v={r.pl_class} />) },
          { id: "status", header: "Status", width: 90, cell: (r) => <span className="text-fg-3">{r.status ?? ""}</span> },
          { id: "amount", header: "Amount", align: "right", width: 120, sortValue: (r) => r.amount, cell: (r) => <span className={r.amount > 0 ? "text-success" : ""}>{money(r.amount, { cents: true })}</span> },
        ]} />
      <CategorizeDialog open={cat} onClose={() => setCat(false)} title={`Categorize ${sel.size} transaction(s)`} pending={pending}
        onSubmit={(pl, c) => run(() => categorizeTransactions([...sel], pl, c), (n) => `Categorized ${n} — outflows added to expenses`, () => { setCat(false); setSel(new Set()); })} />
    </div>
  );
}

export function ExpensesView({ expenses, rules, txns, clients }: { expenses: ExpenseItem[]; rules: RuleItem[]; txns: TxnItem[]; clients: { id: string; name: string }[] }) {
  const [tab, setTab] = useState("expenses");
  const review = txns.filter((t) => !t.ignored && t.amount < 0 && !t.pl_class).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "expenses", label: "Expenses", count: expenses.length },
        { id: "rules", label: "Categorization rules", count: rules.length },
        { id: "mercury", label: "Mercury review", count: review },
      ]} />
      {tab === "expenses" && <ExpensesTab rows={expenses} clients={clients} />}
      {tab === "rules" && <RulesTab rules={rules} />}
      {tab === "mercury" && <MercuryTab txns={txns} />}
    </div>
  );
}
