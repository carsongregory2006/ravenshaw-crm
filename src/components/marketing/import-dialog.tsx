"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { parseCsv, downloadCsv } from "@/components/records/csv";
import { saveAdStatsAction, type AdStatInput } from "@/lib/actions/marketing";

type Target = "date" | "campaign" | "ad_set" | "ad" | "spend" | "impressions" | "clicks" | "leads" | "won_jobs";
const TARGETS: { key: Target; label: string; required?: boolean; guess: RegExp[] }[] = [
  { key: "date", label: "Date (day)", required: true, guess: [/^day$/i, /^date$/i, /reporting starts/i, /reporting ends/i] },
  { key: "campaign", label: "Campaign name", required: true, guess: [/^campaign name$/i, /campaign/i] },
  { key: "ad_set", label: "Ad set name", guess: [/^ad set name$/i, /ad ?set/i] },
  { key: "ad", label: "Ad name", guess: [/^ad name$/i, /^ad$/i] },
  { key: "spend", label: "Amount spent", required: true, guess: [/amount spent/i, /^spend/i, /cost$/i] },
  { key: "impressions", label: "Impressions", guess: [/^impressions$/i, /impressions/i] },
  { key: "clicks", label: "Link clicks", guess: [/^link clicks$/i, /link clicks/i, /^clicks/i] },
  { key: "leads", label: "Leads", guess: [/^leads$/i, /on-facebook leads/i, /website leads/i, /^leads/i, /^results$/i] },
  { key: "won_jobs", label: "Won jobs", guess: [/won/i, /jobs/i] },
];

/** "$1,234.50" / "1 234,50" / "" → number | undefined */
const num = (s: string | undefined) => {
  if (s == null || !s.trim()) return undefined;
  const v = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(v) ? v : undefined;
};
/** Accepts 2026-11-20, 11/20/2026, 20/11/2026 (if day > 12), Nov 20, 2026. */
function toDay(s: string | undefined): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    let [a, b] = [Number(m[1]), Number(m[2])];
    if (a > 12) [a, b] = [b, a];
    return `${m[3]}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function AdImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [data, setData] = React.useState<string[][]>([]);
  const [map, setMap] = React.useState<Partial<Record<Target, number>>>({});
  const [platform, setPlatform] = React.useState("meta");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (!open) { setData([]); setMap({}); } }, [open]);

  const onFile = async (f: File) => {
    const rows = parseCsv(await f.text()).filter((r) => r.some((c) => c.trim()));
    if (rows.length < 2) return toast.error("CSV needs a header row and at least one data row");
    setData(rows);
    const header = rows[0].map((h) => h.trim());
    const used = new Set<number>();
    const m: Partial<Record<Target, number>> = {};
    for (const t of TARGETS) {
      for (const g of t.guess) {
        const i = header.findIndex((h, idx) => !used.has(idx) && g.test(h));
        if (i >= 0) { m[t.key] = i; used.add(i); break; }
      }
    }
    setMap(m);
  };
  const header = data[0] ?? [];
  const body = data.slice(1).filter((r) => !/^total/i.test((r[0] ?? "").trim()));
  const missing = TARGETS.filter((t) => t.required && map[t.key] === undefined);

  const submit = async () => {
    const get = (r: string[], k: Target) => (map[k] === undefined ? undefined : r[map[k]!]);
    const rows: AdStatInput[] = [];
    let bad = 0;
    for (const r of body) {
      const date = toDay(get(r, "date"));
      if (!date) { bad++; continue; }
      rows.push({
        date, campaign: get(r, "campaign") ?? "", ad_set: get(r, "ad_set") ?? "", ad: get(r, "ad") ?? "",
        spend: num(get(r, "spend")), impressions: num(get(r, "impressions")), clicks: num(get(r, "clicks")), leads: num(get(r, "leads")),
        ...(map.won_jobs !== undefined ? { won_jobs: num(get(r, "won_jobs")) } : {}),
      });
    }
    setBusy(true);
    const res = await saveAdStatsAction({ platform, rows });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Imported ${res.data.rows} day rows across ${res.data.ads} ads${bad ? ` · ${bad} rows skipped (no date)` : ""}`);
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Import ad numbers"
      description="Upload an Ads Manager export broken down by day (Breakdown → By time → Day), at ad level. Re-importing the same days updates them."
      footer={<>
        <Button variant="ghost" className="mr-auto" onClick={() => downloadCsv("ad-numbers-template.csv", [["Day", "Campaign name", "Ad set name", "Ad name", "Amount spent", "Impressions", "Link clicks", "Leads", "Won jobs"], ["2026-11-20", "Lawn care — Ottawa", "Homeowners 35+", "Video A", "42.10", "3810", "61", "4", "1"]])}>Download template</Button>
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!body.length || missing.length > 0} onClick={submit}>Import {body.length || ""} rows</Button>
      </>}>
      <div className="space-y-3">
        <Field label="Platform">
          <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="meta">Meta (Facebook / Instagram)</option><option value="google">Google</option><option value="tiktok">TikTok</option><option value="other">Other</option>
          </Select>
        </Field>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-[13px] text-fg-2 hover:bg-hover">
          <FileUp className="size-4" /> {body.length ? `${body.length} rows loaded — choose another file` : "Choose a CSV file"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {header.length > 0 && (
          <div>
            <div className="mb-1 text-xs text-fg-3">Match columns{missing.length ? <span className="text-danger"> · pick a column for {missing.map((m) => m.label).join(", ")}</span> : null}</div>
            <div className="grid grid-cols-2 gap-2">
              {TARGETS.map((t) => (
                <div key={t.key} className="flex items-center gap-2">
                  <span className="w-1/2 text-[13px]">{t.label}{t.required && <span className="text-danger"> *</span>}</span>
                  <Select value={map[t.key] ?? ""} className="h-7 flex-1 text-xs"
                    onChange={(e) => setMap((m) => ({ ...m, [t.key]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
                    <option value="">— Not in file —</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </Select>
                </div>
              ))}
            </div>
            {map.won_jobs === undefined && <p className="mt-2 text-xs text-fg-4">No won jobs column — that&apos;s normal for Meta exports. Add won jobs per ad on the campaign page; re-imports won&apos;t erase them.</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Manual entry: one day of numbers for one ad. */
export function AdEntryDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (o: boolean) => void; defaults?: { campaign?: string; ad_set?: string; ad?: string } }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const blank = { date: today, campaign: "", ad_set: "", ad: "", spend: "", impressions: "", clicks: "", leads: "", won_jobs: "" };
  const [f, setF] = React.useState(blank);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) setF({ ...blank, ...defaults }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add ad numbers" description="One day of numbers for one ad. Saving the same ad and day again replaces it."
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.campaign.trim()} onClick={async () => {
        setBusy(true);
        const res = await saveAdStatsAction({ platform: "meta", rows: [{ date: f.date, campaign: f.campaign, ad_set: f.ad_set, ad: f.ad, spend: num(f.spend) ?? 0, impressions: num(f.impressions) ?? 0, clicks: num(f.clicks) ?? 0, leads: num(f.leads) ?? 0, won_jobs: num(f.won_jobs) ?? 0 }] });
        setBusy(false);
        if (!res.ok) return toast.error(res.error);
        toast.success("Saved");
        onOpenChange(false);
        router.refresh();
      }}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date" className="col-span-2"><Input type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label="Campaign"><Input value={f.campaign} onChange={set("campaign")} /></Field>
        <Field label="Ad set"><Input value={f.ad_set} onChange={set("ad_set")} placeholder="Default ad set" /></Field>
        <Field label="Ad" className="col-span-2"><Input value={f.ad} onChange={set("ad")} placeholder="Default ad" /></Field>
        <Field label="Spend ($)"><Input inputMode="decimal" value={f.spend} onChange={set("spend")} /></Field>
        <Field label="Impressions"><Input inputMode="numeric" value={f.impressions} onChange={set("impressions")} /></Field>
        <Field label="Link clicks"><Input inputMode="numeric" value={f.clicks} onChange={set("clicks")} /></Field>
        <Field label="Leads"><Input inputMode="numeric" value={f.leads} onChange={set("leads")} /></Field>
        <Field label="Won jobs"><Input inputMode="numeric" value={f.won_jobs} onChange={set("won_jobs")} /></Field>
      </div>
    </Dialog>
  );
}
