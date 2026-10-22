"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/misc";
import { Card } from "@/components/ui/misc";
import { deleteSpend, importSpend, saveSpend } from "@/lib/actions/finance";
import { fmtDate, money, num } from "@/lib/utils";
import { CsvButton, parseCsv } from "./csv";

export interface SpendItem { id: string; date: string; channel: string; campaign: string | null; landing_page_id: string | null; amount: number; impressions: number | null; clicks: number | null }

const blank = () => ({ date: new Date().toISOString().slice(0, 10), channel: "", campaign: "", landing_page_id: "", amount: "", impressions: "", clicks: "" });

export function SpendManager({ rows, pages, canEdit }: { rows: SpendItem[]; pages: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<(ReturnType<typeof blank> & { id?: string }) | null>(null);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const pageName = new Map(pages.map((p) => [p.id, p.name]));

  const submit = () => start(async () => {
    if (!form) return;
    const r = await saveSpend({
      id: form.id, date: form.date, channel: form.channel, campaign: form.campaign, landing_page_id: form.landing_page_id || null,
      amount: Number(form.amount), impressions: form.impressions ? Number(form.impressions) : null, clicks: form.clicks ? Number(form.clicks) : null,
    });
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(form.id ? "Spend updated" : "Spend added");
    setForm(null);
    router.refresh();
  });

  const remove = (id: string) => start(async () => {
    if (!confirm("Delete this spend entry?")) return;
    const r = await deleteSpend(id);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Deleted");
    router.refresh();
  });

  const onFile = async (f?: File) => {
    if (!f) return;
    const parsed = parseCsv(await f.text());
    start(async () => {
      const r = await importSpend(parsed);
      if (file.current) file.current.value = "";
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`Imported ${r.data} spend rows`);
      router.refresh();
    });
  };

  const set = (k: string, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <Card title="Marketing spend" padded={false} actions={<>
      <CsvButton filename="marketing-spend" rows={rows.map(({ id, ...r }) => ({ ...r, landing_page: r.landing_page_id ? pageName.get(r.landing_page_id) : "" }))} />
      {canEdit && <>
        <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button size="xs" variant="ghost" icon={Upload} loading={pending && !form} onClick={() => file.current?.click()} title="Headers: date, channel, campaign, amount, impressions, clicks, landing_page">Import CSV</Button>
        <Button size="xs" variant="secondary" icon={Plus} onClick={() => setForm(blank())}>Add spend</Button>
      </>}
    </>}>
      <DataTable rows={rows} empty={<EmptyState title="No spend logged for this period" description="Log ad spend by channel to unlock CPL, CAC and ROAS. Channel should match the lead source / utm_source (e.g. facebook, google)." />}
        columns={[
          { id: "date", header: "Date", sortValue: (r) => r.date, cell: (r) => fmtDate(r.date) },
          { id: "channel", header: "Channel", sortValue: (r) => r.channel, cell: (r) => r.channel },
          { id: "campaign", header: "Campaign", cell: (r) => r.campaign ?? "—" },
          { id: "page", header: "Landing page", cell: (r) => (r.landing_page_id ? pageName.get(r.landing_page_id) ?? "—" : "—") },
          { id: "amount", header: "Amount", align: "right", sortValue: (r) => r.amount, cell: (r) => money(r.amount, { cents: true }) },
          { id: "impr", header: "Impr.", align: "right", cell: (r) => (r.impressions != null ? num(r.impressions) : "—") },
          { id: "clicks", header: "Clicks", align: "right", cell: (r) => (r.clicks != null ? num(r.clicks) : "—") },
          ...(canEdit ? [{
            id: "actions", header: "", width: 64, cell: (r: SpendItem) => (
              <span className="flex justify-end gap-0.5">
                <Button size="xs" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setForm({ id: r.id, date: r.date, channel: r.channel, campaign: r.campaign ?? "", landing_page_id: r.landing_page_id ?? "", amount: String(r.amount), impressions: r.impressions?.toString() ?? "", clicks: r.clicks?.toString() ?? "" })} />
                <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => remove(r.id)} />
              </span>
            ),
          }] : []),
        ]} />
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)} title={form?.id ? "Edit spend" : "Add marketing spend"}
        footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" loading={pending} onClick={submit}>Save</Button></>}>
        {form && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
            <Field label="Amount ($)"><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
            <Field label="Channel" hint="Match utm_source, e.g. facebook"><Input value={form.channel} onChange={(e) => set("channel", e.target.value)} placeholder="facebook" /></Field>
            <Field label="Campaign"><Input value={form.campaign} onChange={(e) => set("campaign", e.target.value)} /></Field>
            <Field label="Landing page" className="col-span-2">
              <Select value={form.landing_page_id} onChange={(e) => set("landing_page_id", e.target.value)}>
                <option value="">None</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Impressions"><Input type="number" min="0" value={form.impressions} onChange={(e) => set("impressions", e.target.value)} /></Field>
            <Field label="Clicks"><Input type="number" min="0" value={form.clicks} onChange={(e) => set("clicks", e.target.value)} /></Field>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
