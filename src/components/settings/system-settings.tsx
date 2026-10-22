"use client";
import { Time } from "@/components/ui/time";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Clock, Download, Play, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { enableScheduler, exportCsv, runTickNow } from "@/lib/actions/settings";
import { fmtDateTime, timeAgo } from "@/lib/utils";
import { PageTitle, Section } from "./section";

interface WebhookEvent { id: string; provider: string; event_type: string | null; external_id: string | null; payload: unknown; processed_at: string | null; error: string | null; created_at: string }

const EXPORTS = ["contacts", "companies", "deals", "invoices", "payments", "expenses", "commissions"] as const;

export function SystemSettings({ events, lastTick, cronConfigured, appUrl }: {
  events: WebhookEvent[]; lastTick: { created_at: string; error: string | null } | null; cronConfigured: boolean; appUrl: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [provider, setProvider] = useState("all");
  const [tickOutput, setTickOutput] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const providers = [...new Set(events.map((e) => e.provider))].sort();
  const shown = provider === "all" ? events : events.filter((e) => e.provider === provider);
  const tickAgeMin = lastTick ? (Date.now() - new Date(lastTick.created_at).getTime()) / 60000 : null;
  const healthy = tickAgeMin != null && tickAgeMin < 5 && !lastTick?.error;

  const download = async (table: (typeof EXPORTS)[number]) => {
    setExporting(table);
    const r = await exportCsv(table);
    setExporting(null);
    if (!r.ok) return toast.error(r.error);
    if (!r.data) return toast.info(`No ${table} to export`);
    const url = URL.createObjectURL(new Blob([r.data], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${table}-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageTitle title="System" description="Background jobs, webhook activity and data export." />

      <Section title="Scheduler" description="A Supabase pg_cron job calls the app every minute to run automations, send recurring invoices, sync Mercury and retry pending contracts.">
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2 text-[13px]">
            <Clock className="size-4 text-fg-3" />
            <span>Last tick:</span>
            {lastTick ? <span><Time value={lastTick.created_at} /></span> : <span className="text-fg-3">never</span>}
            {lastTick && (healthy ? <Tag color="green">Healthy</Tag> : lastTick.error ? <Tag color="red">Error</Tag> : <Tag color="yellow">Stale</Tag>)}
          </div>
          {lastTick?.error && <div className="mt-2 rounded-md bg-danger-soft px-2 py-1.5 font-mono text-xs text-danger">{lastTick.error}</div>}
          {!cronConfigured && <div className="mt-2 text-xs text-warning">CRON_SECRET is not set in the environment.</div>}
          <div className="mt-3 flex gap-2">
            <Button variant="primary" icon={Zap} loading={busy} disabled={!cronConfigured}
              onClick={() => start(async () => { const r = await enableScheduler(); if (r.ok) toast.success("Scheduler enabled", { description: r.data }); else toast.error(r.error); })}>
              Enable scheduler
            </Button>
            <Button icon={Play} loading={busy} disabled={!cronConfigured}
              onClick={() => start(async () => { const r = await runTickNow(); if (r.ok) { setTickOutput(r.data); toast.success("Tick completed"); router.refresh(); } else toast.error(r.error); })}>
              Run tick now
            </Button>
          </div>
          <p className="mt-2 text-xs text-fg-3">Endpoint: <code className="font-mono">{appUrl}/api/cron/tick</code></p>
          {tickOutput && <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-bg-3 p-2 font-mono text-[11px] text-fg-2">{tickOutput}</pre>}
        </div>
      </Section>

      <Section title="Webhook & job log" description="Latest 100 inbound webhooks and scheduler runs."
        actions={<>
          <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="h-7 w-36">
            <option value="all">All providers</option>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Button size="sm" icon={RefreshCw} onClick={() => router.refresh()} aria-label="Refresh" />
        </>}>
        <div className="overflow-hidden rounded-lg border border-border">
          {shown.length === 0 ? <EmptyState title="No events yet" description="Webhooks from Telnyx, Resend, Calendly, PandaDoc and Mercury appear here." /> : (
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-border text-left text-xs text-fg-3">
                <th className="w-6" /><th className="px-2 py-2 font-normal">Provider</th><th className="px-2 py-2 font-normal">Event</th><th className="px-2 py-2 font-normal">Status</th><th className="px-2 py-2 text-right font-normal">Received</th>
              </tr></thead>
              <tbody>
                {shown.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="cursor-pointer border-b border-border-light hover:bg-hover" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <td className="pl-2 text-fg-3">{open === e.id ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</td>
                      <td className="px-2 py-1.5"><Tag>{e.provider}</Tag></td>
                      <td className="max-w-[220px] truncate px-2 py-1.5 font-mono text-xs">{e.event_type ?? "—"}</td>
                      <td className="px-2 py-1.5">{e.error ? <Tag color="red">Error</Tag> : e.processed_at ? <Tag color="green">Processed</Tag> : <Tag color="yellow">Received</Tag>}</td>
                      <td className="px-2 py-1.5 text-right text-xs text-fg-3"><Time value={e.created_at} /></td>
                    </tr>
                    {open === e.id && (
                      <tr className="border-b border-border-light bg-bg-2">
                        <td colSpan={5} className="px-3 py-2">
                          {e.error && <div className="mb-2 rounded-md bg-danger-soft px-2 py-1.5 font-mono text-xs text-danger">{e.error}</div>}
                          <pre className="max-h-72 overflow-auto rounded-md bg-bg-3 p-2 font-mono text-[11px] text-fg-2">{JSON.stringify(e.payload, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>

      <Section title="Export data" description="Download a CSV of any table (admins only).">
        <div className="flex flex-wrap gap-2">
          {EXPORTS.map((t) => (
            <Button key={t} icon={Download} loading={exporting === t} disabled={!!exporting} onClick={() => download(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </Button>
          ))}
        </div>
      </Section>
    </>
  );
}
