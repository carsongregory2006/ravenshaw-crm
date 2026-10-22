"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { UserPicker } from "@/components/records/pickers";
import { parseCsv, downloadCsv } from "@/components/records/csv";
import { importContacts, type ImportRow } from "@/lib/actions/crm";
import { useIsStaff, useProfile } from "@/components/shell/profile-context";

const FIELDS: { value: keyof ImportRow | ""; label: string; guess: RegExp }[] = [
  { value: "", label: "— Skip —", guess: /^$/ },
  { value: "first_name", label: "First name", guess: /^(first|first.?name|given)/i },
  { value: "last_name", label: "Last name", guess: /^(last|last.?name|surname|family)/i },
  { value: "full_name", label: "Full name", guess: /^(name|full.?name|contact)$/i },
  { value: "email", label: "Email", guess: /e-?mail/i },
  { value: "phone", label: "Phone", guess: /(phone|mobile|cell|tel)/i },
  { value: "title", label: "Job title", guess: /(title|position|role)/i },
  { value: "company", label: "Company", guess: /(company|organi[sz]ation|business|account)/i },
  { value: "source", label: "Source", guess: /source/i },
  { value: "tags", label: "Tags (comma/semicolon separated)", guess: /tag/i },
  { value: "status", label: "Status", guess: /status|stage/i },
];

export function ImportDialog({ open, onOpenChange, users }: { open: boolean; onOpenChange: (o: boolean) => void; users: { id: string; full_name: string | null; email: string }[] }) {
  const router = useRouter();
  const profile = useProfile();
  const staff = useIsStaff();
  const [fileName, setFileName] = React.useState("");
  const [data, setData] = React.useState<string[][]>([]);
  const [mapping, setMapping] = React.useState<(keyof ImportRow | "")[]>([]);
  const [trigger, setTrigger] = React.useState(false);
  const [ownerId, setOwnerId] = React.useState<string | null>(profile.id);
  const [source, setSource] = React.useState("import");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { if (!open) { setData([]); setFileName(""); setMapping([]); } }, [open]);

  const onFile = async (f: File) => {
    const rows = parseCsv(await f.text());
    if (rows.length < 2) return toast.error("CSV needs a header row and at least one data row");
    setFileName(f.name);
    setData(rows);
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
    if (!mapping.some(Boolean)) return toast.error("Map at least one column");
    const rows: ImportRow[] = body.map((r) => {
      const o: ImportRow = {};
      mapping.forEach((field, i) => { if (field && r[i]?.trim()) o[field] = r[i].trim(); });
      return o;
    });
    setBusy(true);
    const res = await importContacts(rows, { triggerAutomations: trigger, ownerId, source });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Imported ${res.data.imported} people${res.data.skipped ? ` · skipped ${res.data.skipped} (duplicates/empty)` : ""}`);
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Import people from CSV"
      description="Duplicates (same email) are skipped. Companies are matched by name or created."
      footer={<>
        <Button variant="ghost" className="mr-auto" onClick={() => downloadCsv("people-template.csv", [["First name", "Last name", "Email", "Phone", "Title", "Company", "Source", "Tags"], ["Jane", "Doe", "jane@acme.com", "+15555550100", "COO", "Acme Dental", "referral", "hot;dental"]])}>Download template</Button>
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!body.length}>Import {body.length || ""} rows</Button>
      </>}>
      {!data.length ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-bg-2 px-6 py-12 text-center hover:bg-hover"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
          <FileUp className="size-6 text-fg-3" />
          <span className="text-[13px] font-medium">Drop a CSV here or click to browse</span>
          <span className="text-xs text-fg-3">Exports from HubSpot, GoHighLevel, Google Sheets, etc. all work.</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      ) : (
        <div className="space-y-4 pb-2">
          <p className="text-xs text-fg-3"><b className="text-fg">{fileName}</b> · {body.length} rows. Map each column to a field:</p>
          <div className="max-h-72 overflow-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-bg-2 text-xs text-fg-3"><tr><th className="px-2 py-1.5 text-left font-normal">CSV column</th><th className="px-2 py-1.5 text-left font-normal">Sample</th><th className="px-2 py-1.5 text-left font-normal">Maps to</th></tr></thead>
              <tbody>
                {header.map((h, i) => (
                  <tr key={i} className="border-t border-border-light">
                    <td className="px-2 py-1 font-medium">{h || `Column ${i + 1}`}</td>
                    <td className="max-w-[200px] truncate px-2 py-1 text-fg-3">{body.slice(0, 2).map((r) => r[i]).filter(Boolean).join(", ")}</td>
                    <td className="px-2 py-1 w-56">
                      <Select value={mapping[i] ?? ""} onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? (e.target.value as keyof ImportRow | "") : x)))}>
                        {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {staff && <Field label="Assign owner"><UserPicker value={ownerId} onChange={setOwnerId} users={users.map((u) => ({ ...u }))} /></Field>}
            <Field label="Default source"><Input value={source} onChange={(e) => setSource(e.target.value)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={trigger} onChange={setTrigger} />
            Enroll imported people in active “Lead created” automations
          </label>
        </div>
      )}
    </Dialog>
  );
}
