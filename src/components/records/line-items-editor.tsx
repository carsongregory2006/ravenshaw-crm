"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { upsertLineItem, deleteLineItem } from "@/lib/actions/crm";
import { cn, money } from "@/lib/utils";
import type { DealLineItem, LineItemType } from "@/lib/types";

const TYPES: { value: LineItemType; label: string }[] = [
  { value: "one_time", label: "One-time" },
  { value: "recurring", label: "Recurring" },
  { value: "milestone", label: "Milestone" },
];

const PRESETS: Partial<DealLineItem>[] = [
  { name: "AI automation build (setup)", type: "one_time", unit_price: 5000 },
  { name: "Monthly retainer", type: "recurring", unit_price: 2500, interval_months: 1 },
  { name: "Milestone payment", type: "milestone", unit_price: 2500 },
];

const cell = "h-7 w-full rounded-sm border border-transparent bg-transparent px-1.5 text-[13px] outline-none hover:border-border focus:border-accent focus:bg-bg";

export function LineItemsEditor({ dealId, items: initial, readOnly }: { dealId: string; items: DealLineItem[]; readOnly?: boolean }) {
  const router = useRouter();
  const [items, setItems] = React.useState<DealLineItem[]>(initial);
  React.useEffect(() => setItems(initial), [initial]);
  const [adding, setAdding] = React.useState(false);

  const persist = async (item: DealLineItem) => {
    const r = await upsertLineItem(item);
    if (!r.ok) { toast.error(r.error); return; }
    router.refresh();
  };
  const update = (id: string, patch: Partial<DealLineItem>, save = false) => {
    const next = items.map((x) => (x.id === id ? { ...x, ...patch } : x));
    setItems(next);
    if (save) { const it = next.find((x) => x.id === id); if (it) persist(it); }
  };
  const blurSave = (id: string) => { const it = items.find((x) => x.id === id); if (it) persist(it); };
  const add = async (preset: Partial<DealLineItem> = {}) => {
    setAdding(true);
    const r = await upsertLineItem({ deal_id: dealId, name: preset.name ?? "New item", type: preset.type ?? "one_time", unit_price: preset.unit_price ?? 0, quantity: 1, interval_months: preset.interval_months ?? 1, position: items.length });
    setAdding(false);
    if (!r.ok) return toast.error(r.error);
    setItems((xs) => [...xs, r.data]);
    router.refresh();
  };
  const remove = async (id: string) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const r = await deleteLineItem(id, dealId);
    if (!r.ok) toast.error(r.error);
    router.refresh();
  };

  const oneTime = items.filter((i) => i.type !== "recurring").reduce((a, i) => a + Number(i.unit_price) * i.quantity, 0);
  const mrr = items.filter((i) => i.type === "recurring").reduce((a, i) => a + (Number(i.unit_price) * i.quantity) / Math.max(1, i.interval_months), 0);

  return (
    <Card title="Line items" padded={false} actions={!readOnly && (
      <>
        {items.length === 0 && PRESETS.map((p) => <Button key={p.name} size="xs" variant="ghost" onClick={() => add(p)} disabled={adding}>+ {p.type === "recurring" ? "Retainer" : p.type === "milestone" ? "Milestone" : "Setup fee"}</Button>)}
        <Button size="xs" icon={Plus} onClick={() => add()} loading={adding}>Add item</Button>
      </>
    )}>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-8 text-center">
          <Package className="size-5 text-fg-3" />
          <p className="text-[13px] font-medium">No line items</p>
          <p className="text-xs text-fg-3">Add a setup fee, retainer or milestones. Totals, contracts and invoices use these.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-xs text-fg-3">
              <tr className="border-b border-border-light">
                <th className="px-2 py-1.5 text-left font-normal">Item</th>
                <th className="w-28 px-1 py-1.5 text-left font-normal">Type</th>
                <th className="w-28 px-1 py-1.5 text-right font-normal">Price</th>
                <th className="w-14 px-1 py-1.5 text-right font-normal">Qty</th>
                <th className="w-40 px-1 py-1.5 text-left font-normal">Billing</th>
                <th className="w-24 px-2 py-1.5 text-right font-normal">Total</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="group border-b border-border-light last:border-0">
                  <td className="px-1 py-1">
                    <input disabled={readOnly} className={cn(cell, "font-medium")} value={i.name} onChange={(e) => update(i.id, { name: e.target.value })} onBlur={() => blurSave(i.id)} />
                    <input disabled={readOnly} className={cn(cell, "text-xs text-fg-3")} placeholder="Description (shown on contract)" value={i.description ?? ""} onChange={(e) => update(i.id, { description: e.target.value })} onBlur={() => blurSave(i.id)} />
                  </td>
                  <td className="px-1 py-1 align-top">
                    <select disabled={readOnly} className={cn(cell, "cursor-pointer")} value={i.type} onChange={(e) => update(i.id, { type: e.target.value as LineItemType }, true)}>
                      {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1 align-top">
                    <input disabled={readOnly} type="number" min={0} step="0.01" className={cn(cell, "text-right tabular-nums")} value={i.unit_price} onChange={(e) => update(i.id, { unit_price: Number(e.target.value) })} onBlur={() => blurSave(i.id)} />
                  </td>
                  <td className="px-1 py-1 align-top">
                    <input disabled={readOnly} type="number" min={1} className={cn(cell, "text-right tabular-nums")} value={i.quantity} onChange={(e) => update(i.id, { quantity: Math.max(1, Number(e.target.value)) })} onBlur={() => blurSave(i.id)} />
                  </td>
                  <td className="px-1 py-1 align-top">
                    {i.type === "recurring" ? (
                      <div className="flex items-center gap-1 text-xs text-fg-3">
                        every
                        <select disabled={readOnly} className={cn(cell, "w-auto cursor-pointer")} value={i.interval_months} onChange={(e) => update(i.id, { interval_months: Number(e.target.value) }, true)}>
                          <option value={1}>month</option><option value={3}>quarter</option><option value={6}>6 months</option><option value={12}>year</option>
                        </select>
                        ×
                        <input disabled={readOnly} type="number" min={1} placeholder="∞" title="Billing cycles (blank = until cancelled)" className={cn(cell, "w-10 text-right")}
                          value={i.billing_cycles ?? ""} onChange={(e) => update(i.id, { billing_cycles: e.target.value ? Number(e.target.value) : null })} onBlur={() => blurSave(i.id)} />
                      </div>
                    ) : i.type === "milestone" ? (
                      <input disabled={readOnly} type="date" title="Due date" className={cell} value={i.due_on ?? ""} onChange={(e) => update(i.id, { due_on: e.target.value || null }, true)} />
                    ) : <span className="px-1.5 text-xs text-fg-3">On signing</span>}
                  </td>
                  <td className="px-2 py-1 text-right align-top tabular-nums leading-7">
                    {money(Number(i.unit_price) * i.quantity)}{i.type === "recurring" && <span className="text-xs text-fg-3">/{i.interval_months === 1 ? "mo" : i.interval_months === 12 ? "yr" : `${i.interval_months}mo`}</span>}
                  </td>
                  <td className="px-1 py-1 align-top">
                    {!readOnly && <button onClick={() => remove(i.id)} aria-label="Remove item" className="invisible rounded-sm p-1.5 text-fg-4 hover:text-danger group-hover:visible cursor-pointer"><Trash2 className="size-3.5" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-6 border-t border-border px-3 py-2 text-[13px]">
            <span className="text-fg-3">One-time <b className="ml-1 text-fg tabular-nums">{money(oneTime, { cents: true })}</b></span>
            <span className="text-fg-3">MRR <b className="ml-1 text-success tabular-nums">{money(mrr, { cents: true })}</b></span>
          </div>
        </div>
      )}
    </Card>
  );
}
