"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArrowLeft, FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Page, PageBody } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { MarketingHeader } from "@/components/marketing/header";
import { parseCsv } from "@/components/records/csv";
import { addPastCampaignFileAction, deletePastCampaignAction, deletePastCampaignFileAction, savePastCampaignAction } from "@/lib/actions/marketing";

type Past = { id: string; name: string; platform: string; start_date: string | null; end_date: string | null; notes: string | null; learnings: string | null; updated_at: string };
type FileRow = { id: string; file_name: string; headers: string[]; rows: string[][]; created_at: string };
const dates = (p: Past) => [p.start_date, p.end_date].filter(Boolean).join(" → ") || "No dates";

export function PastView({ campaigns, openId, files }: { campaigns: Past[]; openId: string | null; files: FileRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Past | "new" | null>(null);
  const open = campaigns.find((c) => c.id === openId) ?? null;

  if (open) return (
    <Page>
      <MarketingHeader active="past"
        title={<span className="flex items-center gap-2"><button onClick={() => router.push("/marketing/past")} className="text-fg-3 hover:text-fg cursor-pointer"><ArrowLeft className="size-4" /></button>{open.name}</span>}
        actions={<>
          <Button size="sm" icon={Pencil} onClick={() => setEditing(open)}>Edit</Button>
          <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" onClick={async () => {
            if (!confirm(`Delete "${open.name}" and its uploaded files?`)) return;
            const r = await deletePastCampaignAction(open.id); if (!r.ok) return toast.error(r.error);
            router.push("/marketing/past"); router.refresh();
          }} />
        </>} />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-3"><Tag className="capitalize">{open.platform}</Tag>{dates(open)}</div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Notes"><p className="whitespace-pre-wrap text-[13px]">{open.notes || <span className="text-fg-4">No notes.</span>}</p></Card>
          <Card title="What we learned"><p className="whitespace-pre-wrap text-[13px]">{open.learnings || <span className="text-fg-4">Nothing written yet.</span>}</p></Card>
        </div>
        <Card title={`Files · ${files.length}`} actions={<UploadButton pastId={open.id} />} padded={false}>
          {!files.length ? <p className="px-3 py-6 text-center text-xs text-fg-3">Upload Ads Manager CSV exports to keep the numbers with this campaign.</p> : (
            <div className="divide-y divide-border-light">
              {files.map((f) => (
                <div key={f.id} className="p-3">
                  <div className="mb-2 flex items-center gap-2 text-[13px]">
                    <span className="font-medium">{f.file_name}</span><span className="text-xs text-fg-4">{f.rows.length} rows</span>
                    <Button size="xs" variant="ghost" icon={Trash2} className="ml-auto" aria-label="Delete file" onClick={async () => {
                      if (!confirm(`Delete ${f.file_name}?`)) return;
                      const r = await deletePastCampaignFileAction(f.id); if (!r.ok) return toast.error(r.error); router.refresh();
                    }} />
                  </div>
                  <div className="max-h-[420px] overflow-auto rounded-md border border-border-light">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-bg-2 text-left text-fg-3"><tr>{f.headers.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                      <tbody>{f.rows.map((r, i) => <tr key={i} className="border-t border-border-light">{f.headers.map((_, j) => <td key={j} className="whitespace-nowrap px-2 py-1 tabular-nums">{r[j] ?? ""}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </PageBody>
      {editing && <PastDialog past={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
    </Page>
  );

  return (
    <Page>
      <MarketingHeader active="past" actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing("new")}>Save a campaign</Button>} />
      <PageBody>
        {!campaigns.length ? (
          <EmptyState icon={Archive} title="No past campaigns saved" description="When a campaign ends, save it here with your notes, what you learned and the Ads Manager exports."
            action={<Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>Save a campaign</Button>} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {campaigns.map((c) => (
              <button key={c.id} onClick={() => router.push(`/marketing/past?id=${c.id}`)} className="rounded-lg border border-border p-4 text-left hover:border-fg-4 hover:bg-hover cursor-pointer">
                <div className="flex items-start gap-2"><span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{c.name}</span><Tag className="capitalize">{c.platform}</Tag></div>
                <div className="mt-1 text-xs text-fg-3">{dates(c)}</div>
                {c.learnings && <p className="mt-2 line-clamp-3 text-[13px] text-fg-2"><span className="font-medium">Learned:</span> {c.learnings}</p>}
              </button>
            ))}
          </div>
        )}
      </PageBody>
      {editing && <PastDialog past={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); router.push(`/marketing/past?id=${id}`); router.refresh(); }} />}
    </Page>
  );
}

function UploadButton({ pastId }: { pastId: string }) {
  const router = useRouter();
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <Button size="sm" icon={FileUp} loading={busy} onClick={() => ref.current?.click()}>Upload CSV</Button>
      <input ref={ref} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={async (e) => {
        const list = [...(e.target.files ?? [])];
        e.target.value = "";
        setBusy(true);
        for (const f of list) {
          const rows = parseCsv(await f.text()).filter((r) => r.some((c) => c.trim()));
          if (!rows.length) { toast.error(`${f.name} is empty`); continue; }
          const r = await addPastCampaignFileAction(pastId, { name: f.name, headers: rows[0], rows: rows.slice(1) });
          if (!r.ok) toast.error(`${f.name}: ${r.error}`); else toast.success(`Uploaded ${f.name}`);
        }
        setBusy(false);
        router.refresh();
      }} />
    </>
  );
}

function PastDialog({ past, onClose, onSaved }: { past: Past | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = React.useState({
    name: past?.name ?? "", platform: past?.platform ?? "meta", start_date: past?.start_date ?? "", end_date: past?.end_date ?? "",
    notes: past?.notes ?? "", learnings: past?.learnings ?? "",
  });
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={past ? "Edit past campaign" : "Save a past campaign"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={async () => {
        setBusy(true);
        const r = await savePastCampaignAction({ id: past?.id, ...f, start_date: f.start_date || null, end_date: f.end_date || null });
        if (!r.ok) { setBusy(false); return toast.error(r.error); }
        for (const file of files) {
          const rows = parseCsv(await file.text()).filter((x) => x.some((c) => c.trim()));
          if (!rows.length) continue;
          const u = await addPastCampaignFileAction(r.data.id, { name: file.name, headers: rows[0], rows: rows.slice(1) });
          if (!u.ok) toast.error(`${file.name}: ${u.error}`);
        }
        setBusy(false);
        toast.success("Saved");
        onSaved(r.data.id);
      }}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Campaign name"><Input value={f.name} onChange={set("name")} placeholder="e.g. Spring lawn care — Ottawa" /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Platform"><Select value={f.platform} onChange={set("platform")}><option value="meta">Meta</option><option value="google">Google</option><option value="tiktok">TikTok</option><option value="other">Other</option></Select></Field>
          <Field label="Start date"><Input type="date" value={f.start_date} onChange={set("start_date")} /></Field>
          <Field label="End date"><Input type="date" value={f.end_date} onChange={set("end_date")} /></Field>
        </div>
        <Field label="Notes about the campaign"><Textarea rows={4} value={f.notes} onChange={set("notes")} placeholder="Offer, audience, budget, creatives…" /></Field>
        <Field label="What we learned"><Textarea rows={4} value={f.learnings} onChange={set("learnings")} placeholder="What worked, what didn't, what to try next time" /></Field>
        <Field label="Ads Manager exports (CSV)" hint={past ? "Adds to the files already saved." : undefined}>
          <input type="file" accept=".csv,text/csv" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} className="text-[13px]" />
        </Field>
      </div>
    </Dialog>
  );
}
