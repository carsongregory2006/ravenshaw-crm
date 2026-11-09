"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Copy, ExternalLink, Globe, PlayCircle, Settings2 } from "lucide-react";
import { Page, PageHeader, PageBody } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import { Card, Stat } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/tabs";
import { cn, num, pct, timeAgo } from "@/lib/utils";
import { duration, groupBy, sourceOf, summarize, trackerSnippet } from "@/lib/landers";
import type { LanderVisit } from "@/lib/types";
import { LanderFormDialog } from "./lander-form";

type Lander = { id: string; name: string; external_url: string | null; has_vsl: boolean };

const dash = "—";

export function LanderStats({ lander, visits, range, lastHit, crmLeads }: {
  lander: Lander; visits: LanderVisit[]; range: string; lastHit: string | null; crmLeads: number;
}) {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<"variant" | "source" | "device">("variant");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const s = useMemo(() => summarize(visits), [visits]);
  const showVsl = lander.has_vsl || s.plays > 0;
  const snippet = trackerSnippet(origin, lander.id);

  const daily = useMemo(() => {
    const m = new Map<string, { visits: number; leads: number }>();
    for (const v of visits) {
      const d = new Date(v.started_at).toLocaleDateString("en-CA");
      const e = m.get(d) ?? { visits: 0, leads: 0 };
      e.visits++; if (v.converted) e.leads++;
      m.set(d, e);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-60);
  }, [visits]);
  const maxDay = Math.max(1, ...daily.map(([, d]) => d.visits));

  const groups = useMemo(() => groupBy(visits, breakdown === "variant"
    ? (v) => v.variant || "Default"
    : breakdown === "source" ? sourceOf : (v) => v.device ?? "unknown"), [visits, breakdown]);

  const copy = () => {
    navigator.clipboard.writeText(snippet).then(() => toast.success("Tracking code copied"), () => toast.error("Couldn't copy. Select the code and copy it."));
  };

  return (
    <Page>
      <PageHeader
        icon={Globe}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Link href="/landing-pages" className="text-fg-3 hover:text-fg" aria-label="Back to landers"><ArrowLeft className="size-4" /></Link>
            <span className="truncate">{lander.name}</span>
            {lander.has_vsl && <Tag color="purple">VSL</Tag>}
          </span>
        }
        actions={
          <>
            <Select value={range} onChange={(e) => router.push(`/landing-pages/${lander.id}?range=${e.target.value}`)} className="h-7 w-32 text-[13px]" aria-label="Date range">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">All time</option>
            </Select>
            {lander.external_url && (
              <a href={lander.external_url} target="_blank" rel="noreferrer"><Button size="sm" icon={ExternalLink}>Open</Button></a>
            )}
            <Button size="sm" icon={Settings2} onClick={() => setSettingsOpen(true)}>Settings</Button>
          </>
        }
      />
      <PageBody className="space-y-3 p-3">
        <Card title="Tracking code" actions={
          lastHit
            ? <Tag color="green" dot>Receiving data · last visit {timeAgo(lastHit)}</Tag>
            : <Tag color="yellow" dot>Waiting for first visit</Tag>
        }>
          <p className="mb-2 text-xs text-fg-3">
            Paste this before <code>&lt;/body&gt;</code> on your lander (in Framer, Webflow or Carrd use the custom code / embed setting), then open the page once to test.
            For a split test, add <code>data-variant=&quot;B&quot;</code> to the tag on the second version, or link to it with <code>?variant=B</code>.
          </p>
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-bg-2 p-2 text-[11px]">{snippet}</pre>
            <Button size="sm" icon={Copy} onClick={copy}>Copy</Button>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Visits" value={num(s.visits)} sub={`${num(s.visitors)} unique visitors`} />
          <Stat label="Avg time on page" value={s.visits ? duration(s.avgTime) : dash} sub={s.visits ? `${pct(s.bounceRate, 0)} bounced in under 10s` : undefined} />
          <Stat label="Scroll depth" value={s.visits ? `${Math.round(s.avgScroll)}%` : dash} sub={s.visits ? `${pct(s.clickRate, 0)} clicked a button or link` : undefined} />
          <Stat label="Leads" value={num(s.leads)} sub={s.visits ? `${pct(s.convRate)} conversion · ${num(s.booked)} booked` : `${num(crmLeads)} in CRM from this page`} />
        </div>

        {showVsl && (
          <Card title={<span className="flex items-center gap-1.5"><PlayCircle className="size-4 text-accent" />VSL</span>}>
            {s.plays === 0 ? (
              <p className="py-4 text-center text-[13px] text-fg-3">No plays yet. Watch time shows up here once someone presses play.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Pressed play" value={pct(s.playRate, 0)} sub={`${num(s.plays)} plays`} />
                  <Stat label="Avg watch time" value={duration(s.avgWatch)} sub={`${Math.round(s.avgPctWatched)}% of the video`} />
                  <Stat label="Watched to the end" value={pct(s.completionRate, 0)} />
                  <Stat label="Conv. if watched 50%+" value={s.convWatchedHalf == null ? dash : pct(s.convWatchedHalf)}
                    sub={s.convOthers == null ? undefined : `vs ${pct(s.convOthers)} for everyone else`} />
                </div>
                <div>
                  <div className="mb-2 text-xs text-fg-3">Still watching at each point (of people who pressed play)</div>
                  <div className="space-y-1.5">
                    {s.retention.map((r) => (
                      <div key={r.mark} className="flex items-center gap-2 text-xs">
                        <span className="w-10 shrink-0 text-right tabular-nums text-fg-3">{r.mark}%</span>
                        <div className="h-4 min-w-0 flex-1 rounded-sm bg-bg-2">
                          <div className="h-full rounded-sm bg-accent" style={{ width: `${Math.max(1, r.share * 100)}%` }} />
                        </div>
                        <span className="w-10 shrink-0 tabular-nums">{pct(r.share, 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}

        <Card title="Visits per day">
          {daily.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-fg-3">No visits in this range yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex h-36 min-w-full items-end gap-1" style={{ width: Math.max(daily.length * 18, 300) }}>
                {daily.map(([d, v]) => (
                  <div key={d} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d}: ${v.visits} visits, ${v.leads} leads`}>
                    <div className="relative w-full rounded-t-sm bg-accent/25" style={{ height: `${(v.visits / maxDay) * 100}%` }}>
                      {v.leads > 0 && <div className="absolute inset-x-0 bottom-0 rounded-t-sm bg-accent" style={{ height: `${(v.leads / v.visits) * 100}%` }} />}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-fg-4"><span>{daily[0][0]}</span><span>{daily[daily.length - 1][0]}</span></div>
              <div className="mt-1 flex gap-3 text-[11px] text-fg-3">
                <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-accent/25" />Visits</span>
                <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-accent" />Leads</span>
              </div>
            </div>
          )}
        </Card>

        <Card padded={false}>
          <Tabs
            tabs={[{ id: "variant", label: "By variant" }, { id: "source", label: "By source" }, { id: "device", label: "By device" }]}
            value={breakdown}
            onChange={(t) => setBreakdown(t as typeof breakdown)}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-border-light text-left text-xs text-fg-3">
                  <th className="px-3 py-2 font-normal">{breakdown === "variant" ? "Variant" : breakdown === "source" ? "Source" : "Device"}</th>
                  {["Visits", "Avg time", "Bounce", "Scroll", ...(showVsl ? ["Played", "Avg watch"] : []), "Leads", "Conv.", "Booked"].map((h) => (
                    <th key={h} className="px-3 py-2 text-right font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-6 text-center text-fg-3">No data yet.</td></tr>
                )}
                {groups.map((g) => {
                  const best = breakdown === "variant" && groups.length > 1 && g.visits >= 20 && g.convRate === Math.max(...groups.filter((x) => x.visits >= 20).map((x) => x.convRate));
                  return (
                    <tr key={g.name} className="border-b border-border-light last:border-0 tabular-nums">
                      <td className="px-3 py-2 font-medium capitalize">
                        <span className="flex items-center gap-1.5">{g.name}{best && <Tag color="green">Best</Tag>}</span>
                      </td>
                      <td className="px-3 py-2 text-right">{num(g.visits)}</td>
                      <td className="px-3 py-2 text-right">{duration(g.avgTime)}</td>
                      <td className="px-3 py-2 text-right">{pct(g.bounceRate, 0)}</td>
                      <td className="px-3 py-2 text-right">{Math.round(g.avgScroll)}%</td>
                      {showVsl && <td className="px-3 py-2 text-right">{pct(g.playRate, 0)}</td>}
                      {showVsl && <td className="px-3 py-2 text-right">{g.plays ? duration(g.avgWatch) : dash}</td>}
                      <td className="px-3 py-2 text-right">{num(g.leads)}</td>
                      <td className={cn("px-3 py-2 text-right", best && "font-semibold text-success")}>{pct(g.convRate)}</td>
                      <td className="px-3 py-2 text-right">{num(g.booked)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {breakdown === "variant" && groups.length > 1 && (
            <p className="border-t border-border-light px-3 py-2 text-xs text-fg-3">&quot;Best&quot; only appears once each variant has at least 20 visits. Give a split test a few hundred visits per variant before trusting it.</p>
          )}
        </Card>
      </PageBody>
      <LanderFormDialog open={settingsOpen} onOpenChange={setSettingsOpen} lander={lander} />
    </Page>
  );
}
