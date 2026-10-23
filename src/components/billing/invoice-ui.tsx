"use client";
import { Time } from "@/components/ui/time";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Copy, ExternalLink, MoreHorizontal, Plus, RotateCw, Trash2, CheckCircle2, Receipt, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Switch, Checkbox } from "@/components/ui/input";
import { StatusTag, Tag } from "@/components/ui/badge";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/misc";
import { cn, fmtDate, money } from "@/lib/utils";
import {
  createInvoiceAction, markInvoicePaid, retryInvoice, voidInvoice, updateSchedule, deleteSchedule, createSchedule,
} from "@/lib/actions/billing";
import type { BillingSchedule, DealLineItem, Invoice, LineItemType } from "@/lib/types";

type ActionRes = { ok: true } | { ok: false; error: string };
async function run<T extends ActionRes>(p: Promise<T>, success: string, after?: () => void) {
  const r = await p;
  if (r.ok) { toast.success(success); after?.(); } else toast.error(r.error);
  return r;
}

export const KIND_LABEL: Record<LineItemType, string> = { one_time: "One-time", recurring: "Recurring", milestone: "Milestone" };

// ───────── Invoice table ─────────
export function InvoiceTable({ invoices, canManage, onChange, showContact, compact }: {
  invoices: (Invoice & { contact_name?: string; deal_number?: string })[];
  canManage: boolean;
  onChange?: () => void;
  showContact?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [paying, setPaying] = useState<Invoice | null>(null);
  const done = () => { onChange?.(); router.refresh(); };

  if (!invoices.length) return <EmptyState icon={Receipt} title="No invoices yet" description="Invoices are created automatically when a contract is signed, or manually." className="py-8" />;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-xs text-fg-3">
              <th className="h-8 px-2 font-normal">Invoice</th>
              {showContact && <th className="px-2 font-normal">Client</th>}
              {!compact && <th className="px-2 font-normal">Type</th>}
              <th className="px-2 font-normal">Status</th>
              <th className="px-2 font-normal">Due</th>
              <th className="px-2 text-right font-normal">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-t border-border-light hover:bg-hover">
                <td className="h-9 px-2">
                  <div className="font-medium">{inv.invoice_number}</div>
                  {!compact && inv.description && <div className="max-w-[260px] truncate text-xs text-fg-3">{inv.description}</div>}
                  {inv.status === "error" && inv.error && <div className="max-w-[260px] truncate text-xs text-danger" title={inv.error}>{inv.error}</div>}
                </td>
                {showContact && <td className="px-2"><div className="truncate">{inv.contact_name ?? "—"}</div>{inv.deal_number && <div className="text-xs text-fg-3">{inv.deal_number}</div>}</td>}
                {!compact && <td className="px-2"><Tag color={inv.kind === "recurring" ? "purple" : inv.kind === "milestone" ? "orange" : "blue"}>{KIND_LABEL[inv.kind]}</Tag></td>}
                <td className="px-2"><StatusTag status={inv.status} /></td>
                <td className="px-2 text-fg-2">{inv.status === "paid" ? <span className="text-success">Paid <Time value={inv.paid_at} format="date" /></span> : fmtDate(inv.due_date, "MMM d")}</td>
                <td className="px-2 text-right font-medium tabular-nums">{money(inv.amount, { cents: true })}</td>
                <td className="px-1">
                  <Menu>
                    <MenuTrigger asChild><Button size="xs" variant="ghost" icon={MoreHorizontal} aria-label="Invoice actions" /></MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem icon={Copy} disabled={!inv.payment_url} onSelect={() => { navigator.clipboard.writeText(inv.payment_url!); toast.success("Payment link copied"); }}>Copy payment link</MenuItem>
                      <MenuItem icon={ExternalLink} disabled={!inv.payment_url} onSelect={() => window.open(inv.payment_url!, "_blank")}>Open payment page</MenuItem>
                      {canManage && (
                        <>
                          <MenuSeparator />
                          <MenuItem icon={RotateCw} disabled={inv.status === "paid" || inv.status === "void"} onSelect={() => run(retryInvoice(inv.id), inv.status === "error" ? "Invoice re-sent" : "Invoice re-sent through Stripe", done)}>
                            {inv.status === "error" ? "Retry sending" : "Resend via Stripe"}
                          </MenuItem>
                          <MenuItem icon={CheckCircle2} disabled={inv.status === "paid" || inv.status === "void"} onSelect={() => setPaying(inv)}>Mark as paid…</MenuItem>
                          <MenuItem icon={Ban} danger disabled={inv.status === "paid" || inv.status === "void"} onSelect={() => { if (confirm(`Void ${inv.invoice_number}? This also voids it in Stripe.`)) run(voidInvoice(inv.id), "Invoice voided", done); }}>Void invoice</MenuItem>
                        </>
                      )}
                    </MenuContent>
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paying && <MarkPaidDialog invoice={paying} onClose={() => setPaying(null)} onDone={done} />}
    </>
  );
}

export function MarkPaidDialog({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(invoice.amount));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("etransfer");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    const r = await run(markInvoicePaid(invoice.id, { amount: Number(amount), date, method, note }), "Payment recorded · commissions calculated", onDone);
    setLoading(false);
    if (r.ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Record payment · ${invoice.invoice_number}`} description="Use when money arrived outside Stripe invoicing (e-Transfer, cheque, cash). Rep commission is accrued on this cash." size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={loading} onClick={submit}>Record payment</Button></>}>
      <div className="space-y-3">
        <Field label="Amount"><Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Received on"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="etransfer">Interac e-Transfer</option><option value="ach">Bank transfer / EFT</option><option value="wire">Wire</option><option value="card">Card</option>
            <option value="check">Cheque</option><option value="stripe">Stripe</option><option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
      </div>
    </Dialog>
  );
}

// ───────── Create invoice ─────────
interface DraftLine { key: string; name: string; amount: string; qty: string; kind: LineItemType; line_item_id?: string; checked: boolean }

export function CreateInvoiceDialog({ open, onClose, contactId, dealId, clientId, lineItems = [], onDone }: {
  open: boolean; onClose: () => void; contactId: string | null; dealId?: string | null; clientId?: string | null; lineItems?: DealLineItem[]; onDone: () => void;
}) {
  const [lines, setLines] = useState<DraftLine[]>(() => lineItems.map((li) => ({
    key: li.id, name: li.name, amount: String(li.unit_price), qty: String(li.quantity), kind: li.type, line_item_id: li.id, checked: false,
  })));
  const [custom, setCustom] = useState<DraftLine[]>(lineItems.length ? [] : [{ key: "c0", name: "", amount: "", qty: "1", kind: "one_time", checked: true }]);
  const [dueDays, setDueDays] = useState("7");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const chosen = [...lines.filter((l) => l.checked), ...custom.filter((l) => l.name.trim() && Number(l.amount) > 0)];
  const total = chosen.reduce((a, l) => a + Number(l.amount) * Number(l.qty || 1), 0);

  const submit = async () => {
    if (!contactId) return toast.error("This record has no contact to bill");
    if (!chosen.length) return toast.error("Add at least one line");
    setLoading(true);
    const r = await createInvoiceAction({
      dealId, clientId, contactId, dueDays: Number(dueDays), description: description || undefined,
      items: chosen.map((l) => ({ name: l.name, amount: Number(l.amount), qty: Number(l.qty || 1), kind: l.kind, line_item_id: l.line_item_id ?? null })),
    });
    setLoading(false);
    if (!r.ok) return toast.error(r.error);
    if (r.data.status === "error") toast.warning(`Invoice ${r.data.invoice_number} saved but Stripe failed: ${r.data.error}`);
    else toast.success(`Invoice ${r.data.invoice_number} sent via Stripe`);
    onDone();
    onClose();
  };

  const updCustom = (i: number, patch: Partial<DraftLine>) => setCustom((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Create invoice" description="Sends a Stripe invoice (card, bank debit) to the client's email." size="lg"
      footer={<><span className="mr-auto self-center text-[13px] text-fg-2">Total <b className="text-fg">{money(total, { cents: true })}</b></span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={loading} onClick={submit} disabled={!chosen.length}>Send invoice</Button></>}>
      <div className="space-y-4">
        {lines.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-fg-2">From deal line items</div>
            <div className="divide-y divide-border-light rounded-md border border-border">
              {lines.map((l, i) => (
                <label key={l.key} className="flex cursor-pointer items-center gap-2 px-2 py-2 hover:bg-hover">
                  <Checkbox checked={l.checked} onChange={(e) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} />
                  <span className="flex-1 truncate">{l.name}</span>
                  <Tag color={l.kind === "recurring" ? "purple" : l.kind === "milestone" ? "orange" : "blue"}>{KIND_LABEL[l.kind]}</Tag>
                  <span className="w-24 text-right tabular-nums">{money(Number(l.amount) * Number(l.qty), { cents: true })}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-fg-2">
            Custom lines
            <Button size="xs" variant="ghost" icon={Plus} onClick={() => setCustom((xs) => [...xs, { key: `c${Date.now()}`, name: "", amount: "", qty: "1", kind: "one_time", checked: true }])}>Add line</Button>
          </div>
          <div className="space-y-2">
            {custom.map((l, i) => (
              <div key={l.key} className="flex items-center gap-2">
                <Input placeholder="Description" value={l.name} onChange={(e) => updCustom(i, { name: e.target.value })} className="flex-1" />
                <Select value={l.kind} onChange={(e) => updCustom(i, { kind: e.target.value as LineItemType })} className="w-32">
                  <option value="one_time">One-time</option><option value="recurring">Recurring</option><option value="milestone">Milestone</option>
                </Select>
                <Input type="number" placeholder="Qty" value={l.qty} onChange={(e) => updCustom(i, { qty: e.target.value })} className="w-16" />
                <Input type="number" step="0.01" placeholder="Price" value={l.amount} onChange={(e) => updCustom(i, { amount: e.target.value })} className="w-28" />
                <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove line" onClick={() => setCustom((xs) => xs.filter((_, j) => j !== i))} />
              </div>
            ))}
            {!custom.length && <p className="text-xs text-fg-3">Add a custom line for ad-hoc charges.</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due in (days)"><Input type="number" min="0" value={dueDays} onChange={(e) => setDueDays(e.target.value)} /></Field>
          <Field label="Memo (shown to client)"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></Field>
        </div>
      </div>
    </Dialog>
  );
}

// ───────── Billing schedules ─────────
export function ScheduleList({ schedules, canManage, onChange, clientId }: { schedules: BillingSchedule[]; canManage: boolean; onChange?: () => void; clientId?: string | null }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const done = () => { onChange?.(); router.refresh(); };
  return (
    <div>
      {schedules.length === 0 ? (
        <p className="px-2 py-3 text-[13px] text-fg-3">No upcoming automatic invoices.</p>
      ) : (
        <ul className="divide-y divide-border-light">
          {schedules.map((s) => (
            <li key={s.id} className={cn("flex items-center gap-3 px-2 py-2 text-[13px]", !s.active && "opacity-60")}>
              <CalendarClock className="size-4 text-fg-3" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.description}</div>
                <div className="text-xs text-fg-3">
                  {money(s.amount, { cents: true })} {s.description.startsWith("Milestone:") ? "once" : `every ${s.interval_months === 1 ? "month" : `${s.interval_months} months`}`}
                  {s.cycles_remaining != null && ` · ${s.cycles_remaining} left`}
                </div>
              </div>
              {canManage ? (
                <Input type="date" className="w-36" defaultValue={s.next_invoice_date} disabled={!s.active}
                  onBlur={(e) => e.target.value !== s.next_invoice_date && e.target.value && run(updateSchedule(s.id, { next_invoice_date: e.target.value }), "Next invoice date updated", done)} />
              ) : <span className="text-fg-2">{fmtDate(s.next_invoice_date)}</span>}
              {canManage && (
                <>
                  <span title={s.active ? "Pause" : "Resume"}><Switch checked={s.active} onChange={(v) => run(updateSchedule(s.id, { active: v }), v ? "Billing resumed" : "Billing paused", done)} /></span>
                  <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete schedule" onClick={() => { if (confirm("Delete this billing schedule? No more invoices will be generated from it.")) run(deleteSchedule(s.id), "Schedule deleted", done); }} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && clientId && (
        <div className="px-2 pt-2"><Button size="xs" variant="ghost" icon={Plus} onClick={() => setAdding(true)}>Add recurring charge</Button></div>
      )}
      {adding && clientId && <AddScheduleDialog clientId={clientId} onClose={() => setAdding(false)} onDone={done} />}
    </div>
  );
}

function AddScheduleDialog({ clientId, onClose, onDone }: { clientId: string; onClose: () => void; onDone: () => void }) {
  const [description, setDescription] = useState("Monthly retainer");
  const [amount, setAmount] = useState("");
  const [interval, setIntervalMonths] = useState("1");
  const [nextDate, setNextDate] = useState(new Date().toISOString().slice(0, 10));
  const [cycles, setCycles] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    const r = await run(createSchedule({ clientId, description, amount: Number(amount), intervalMonths: Number(interval), nextDate, cycles: cycles ? Number(cycles) : null }), "Recurring charge added", onDone);
    setLoading(false);
    if (r.ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add recurring charge" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={loading} disabled={!description || !(Number(amount) > 0)} onClick={submit}>Add</Button></>}>
      <div className="space-y-3">
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount"><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Every (months)"><Input type="number" min="1" value={interval} onChange={(e) => setIntervalMonths(e.target.value)} /></Field>
          <Field label="First invoice on"><Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} /></Field>
          <Field label="Number of invoices" hint="Blank = until cancelled"><Input type="number" min="1" value={cycles} onChange={(e) => setCycles(e.target.value)} /></Field>
        </div>
      </div>
    </Dialog>
  );
}
