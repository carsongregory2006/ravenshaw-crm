"use client";
import * as React from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { Page, PageBody } from "@/components/ui/page";
import { Card } from "@/components/ui/misc";
import { MarketingHeader, fmtInt, fmtMoney } from "@/components/marketing/header";
import { cn } from "@/lib/utils";

type Row = { id: string; name: string; sub: string; href: string; spend: number; leads: number; won_jobs: number };
type Metric = "cpl" | "cpw";

function rank(rows: Row[], metric: Metric) {
  const val = (r: Row) => (metric === "cpl" ? (r.leads ? r.spend / r.leads : null) : r.won_jobs ? r.spend / r.won_jobs : null);
  const has = rows.filter((r) => val(r) != null).sort((a, b) => val(a)! - val(b)!);
  return { ranked: has, none: rows.filter((r) => val(r) == null), val };
}

function Board({ title, rows, metric }: { title: string; rows: Row[]; metric: Metric }) {
  const { ranked, none, val } = rank(rows, metric);
  return (
    <Card title={title} padded={false}>
      {!rows.length ? <p className="px-3 py-6 text-center text-xs text-fg-3">Nothing has enough data yet.</p> : (
        <table className="w-full text-[13px]">
          <thead className="text-left text-xs text-fg-3">
            <tr className="border-b border-border-light">
              <th className="w-8 px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">{metric === "cpl" ? "Cost / lead" : "Cost / won job"}</th>
              <th className="px-3 py-2 text-right font-medium">Spend</th><th className="px-3 py-2 text-right font-medium">Leads</th><th className="px-3 py-2 text-right font-medium">Won</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <tr key={r.id} className="border-b border-border-light last:border-0">
                <td className={cn("px-3 py-2 tabular-nums", i === 0 ? "font-semibold text-accent" : "text-fg-3")}>{i + 1}</td>
                <td className="px-3 py-2"><Link href={r.href} className="font-medium hover:underline">{r.name}</Link><div className="text-xs text-fg-4">{r.sub}</div></td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtMoney(val(r))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.spend)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.leads)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.won_jobs)}</td>
              </tr>
            ))}
            {none.length > 0 && <tr><td colSpan={6} className="px-3 py-2 text-xs text-fg-4">{none.length} more with no won jobs yet: {none.map((r) => r.name).join(", ")}</td></tr>}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function WinnersView({ days, ads, landers, skipped, minSpend, minLeads }: { days: number; ads: Row[]; landers: Row[]; skipped: { ads: number; landers: number }; minSpend: number; minLeads: number }) {
  const [metric, setMetric] = React.useState<Metric>("cpl");
  return (
    <Page>
      <MarketingHeader active="winners" days={days} actions={
        <div className="flex items-center rounded-md border border-border p-0.5">
          {([["cpl", "Cost per lead"], ["cpw", "Cost per won job"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMetric(k)} className={cn("h-6 rounded px-2 text-xs cursor-pointer", metric === k ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover")}>{label}</button>
          ))}
        </div>
      } />
      <PageBody>
        <p className="mb-3 flex items-center gap-1.5 text-xs text-fg-3"><Trophy className="size-3.5 text-accent" />Best first, last {days} days. Only counts things with at least ${minSpend} spent and {minLeads} leads{skipped.ads + skipped.landers ? ` (${skipped.ads} ads and ${skipped.landers} landers skipped for too little data)` : ""}.</p>
        <div className="grid gap-4 xl:grid-cols-2">
          <Board title="Ads" rows={ads} metric={metric} />
          <Board title="Landing pages & forms" rows={landers} metric={metric} />
        </div>
      </PageBody>
    </Page>
  );
}
