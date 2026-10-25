"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/misc";
import { parseCsv, downloadCsv } from "@/components/records/csv";
import { createClient } from "@/lib/supabase/client";
import { createListFromContactsAction, importLeadListAction, type LeadImportRow } from "@/lib/actions/dialer";
import { contactLabel, fmtPhone } from "@/lib/utils";

const FIELDS: { value: keyof LeadImportRow | ""; label: string; guess: RegExp }[] = [
  { value: "", label: "— Skip —", guess: /^$/ },
  { value: "full_name", label: "Name", guess: /^(name|full.?name|contact|owner)$/i },
  { value: "first_name", label: "First name", guess: /^(first|first.?name|given)/i },
  { value: "last_name", label: "Last name", guess: /^(last|last.?name|surname|family)/i },
  { value: "phone", label: "Phone", guess: /(phone|mobile|cell|tel|number)/i },
  { value: "email", label: "Email", guess: /e-?mail/i },
  { value: "company", label: "Company", guess: /(company|business|organi[sz]ation|account)/i },
  { value: "notes", label: "Notes", guess: /(note|comment|description)/i },
];

export function LeadImportDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (listId: string) => void }) {
  const [name, setName] = useState("");
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(keyof LeadImportRow | "")[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!open) { setData([]); setMapping([]); setName(""); } }, [open]);

  const onFile = async (f: File) => {
    const rows = parseCsv(await f.text()).filter((r) => r.some((c) => c.trim()));
    if (rows.length < 2) return toast.error("CSV needs a header row and at least one data row");
    setData(rows);
    if (!name) setName(f.name.replace(/\.csv$/i, ""));
    const used = new Set<string>();
    setMapping(rows[0].map((h) => {
      const m = FIELDS.find((x) => x.value && !used.has(x.value) && x.guess.test(h.trim()));
      if (m?.value) used.add(m.value);
      return m?.value ?? "";
    }));
  };

  const header = data[0] ?? [];
  const body = data.slice(1);

  const submit = async () => {
    if (!mapping.includes("phone")) return toast.error("Map a column to Phone");
    const rows: LeadImportRow[] = body.map((r) => {
      const o: LeadImportRow = {};
      mapping.forEach((field, i) => { if (field && r[i]?.trim()) o[field] = r[i].trim(); });
      return o;
    });
    setBusy(true);
    const res = await importLeadListAction({ name, rows });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    const d = res.data;
    const skipped = [
      d.skippedDnc && `${d.skippedDnc} Do Not Contact`, d.skippedBad && `${d.skippedBad} bad numbers`,
      d.skippedNoPhone && `${d.skippedNoPhone} without a phone`, d.duplicateRows && `${d.duplicateRows} duplicate rows`,
    ].filter(Boolean).join(", ");
    toast.success(`List saved: ${d.added} leads (${d.created} new, ${d.matched} already in CRM)${skipped ? ` · skipped ${skipped}` : ""}`, { duration: 8000 });
    onOpenChange(false);
    onDone(d.listId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Import a lead list"
      description="Leads are matched to existing people by phone (no duplicates). Do Not Contact and bad numbers are skipped."
      footer={<>
        <Button variant="ghost" className="mr-auto" onClick={() => downloadCsv("lead-list-template.csv", [["Name", "Phone", "Email", "Company", "Notes"], ["Jane Doe", "+16135550100", "jane@greenlawns.ca", "Green Lawns Ottawa", "Owner, 3 trucks"]])}>Download template</Button>
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!body.length || !name.trim()}>Import {body.length || ""} rows</Button>
      </>}>
      <div className="space-y-3">
        <Field label="List name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ottawa landscapers — May" /></Field>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-[13px] text-fg-2 hover:bg-hover">
          <FileUp className="size-4" /> {body.length ? `${body.length} rows loaded — choose another file` : "Choose a CSV file"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {header.length > 0 && (
          <div>
            <div className="mb-1 text-xs text-fg-3">Map columns</div>
            <div className="grid grid-cols-2 gap-2">
              {header.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-1/2 truncate text-[13px]" title={h}>{h || `Column ${i + 1}`}<span className="ml-1 text-xs text-fg-4">{body[0]?.[i] ? `e.g. ${body[0][i].slice(0, 20)}` : ""}</span></span>
                  <Select value={mapping[i] ?? ""} onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? (e.target.value as keyof LeadImportRow | "") : x)))} className="h-7 flex-1 text-xs">
                    {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

interface ContactRow { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; status: string; tags: string[]; do_not_contact: boolean; phone_bad: boolean; company: { name: string } | null }

/** Build a list from people already in the CRM, with simple filters. */
export function ContactsListDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (listId: string) => void }) {
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!open) { setSel(new Set()); setName(""); } }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(async () => {
      let query = createClient().from("contacts")
        .select("id, first_name, last_name, email, phone, status, tags, do_not_contact, phone_bad, company:companies(name)")
        .not("phone", "is", null).order("updated_at", { ascending: false }).limit(1000);
      if (status) query = query.eq("status", status);
      if (tag.trim()) query = query.contains("tags", [tag.trim()]);
      if (q.trim()) { const like = `%${q.trim()}%`; query = query.or(`first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`); }
      const { data } = await query;
      setRows((data as unknown as ContactRow[]) ?? []);
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [open, q, status, tag]);

  const dialable = useMemo(() => rows.filter((r) => !r.do_not_contact && !r.phone_bad), [rows]);

  const submit = async () => {
    setBusy(true);
    const r = await createListFromContactsAction(name, [...sel]);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(`List saved with ${r.data.added} leads${r.data.skipped ? ` · ${r.data.skipped} skipped` : ""}`);
    onOpenChange(false);
    onDone(r.data.listId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl" title="New list from contacts" description="People without a phone, marked Do Not Contact, or with a bad number can't be added."
      footer={<>
        <span className="mr-auto self-center text-xs text-fg-3">{sel.size} selected</span>
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!sel.size || !name.trim()} onClick={submit}>Save list</Button>
      </>}>
      <div className="space-y-2">
        <Field label="List name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Warm leads to re-call" /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {["lead", "prospect", "client", "churned", "unqualified"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </Select>
          <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Has tag (exact)" />
        </div>
        {loading ? <div className="flex justify-center py-8"><Spinner /></div> : (
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-fg-3">
              <tr className="border-b border-border-light">
                <th className="w-8 py-1.5"><Checkbox checked={dialable.length > 0 && dialable.every((r) => sel.has(r.id))}
                  onChange={(e) => setSel((s) => { const n = new Set(s); for (const r of dialable) { if (e.target.checked) n.add(r.id); else n.delete(r.id); } return n; })} /></th>
                <th className="py-1.5 font-medium">Name ({rows.length}{rows.length === 1000 ? "+" : ""})</th><th className="py-1.5 font-medium">Company</th><th className="py-1.5 font-medium">Phone</th><th className="py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ok = !r.do_not_contact && !r.phone_bad;
                return (
                  <tr key={r.id} className={ok ? "border-b border-border-light" : "border-b border-border-light text-fg-4"}>
                    <td className="py-1.5"><Checkbox disabled={!ok} checked={sel.has(r.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                    <td className="py-1.5">{contactLabel(r) || "Unnamed"}</td>
                    <td className="py-1.5 text-fg-3">{r.company?.name ?? ""}</td>
                    <td className="py-1.5 tabular-nums">{fmtPhone(r.phone)}{r.phone_bad && <Tag className="ml-1" color="red">Bad</Tag>}{r.do_not_contact && <Tag className="ml-1" color="red">DNC</Tag>}</td>
                    <td className="py-1.5 capitalize text-fg-3">{r.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}
