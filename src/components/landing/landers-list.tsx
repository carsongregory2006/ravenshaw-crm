"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Globe, Plug, PlayCircle } from "lucide-react";
import { Page, PageHeader, PageBody } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Tag } from "@/components/ui/badge";
import { EmptyState, Stat } from "@/components/ui/misc";
import { num, pct, timeAgo } from "@/lib/utils";
import { duration, type LanderSummary } from "@/lib/landers";
import { LanderFormDialog } from "./lander-form";

export type LanderRow = {
  id: string; name: string; external_url: string | null; has_vsl: boolean; lastHit: string | null;
} & LanderSummary;

const dash = <span className="text-fg-4">—</span>;

export function LandersList({ rows, total }: { rows: LanderRow[]; total: LanderSummary }) {
  const router = useRouter();
  const [connectOpen, setConnectOpen] = useState(false);

  const columns: Column<LanderRow>[] = [
    {
      id: "name", header: "Lander", icon: Globe, width: 260, sortValue: (r) => r.name.toLowerCase(), cell: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{r.name}</span>
          {r.has_vsl && <Tag color="purple">VSL</Tag>}
        </span>
      ),
    },
    {
      id: "url", header: "URL", width: 220, cell: (r) => r.external_url ? (
        <a href={r.external_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-1 text-fg-2 hover:text-fg">
          <span className="truncate">{r.external_url.replace(/^https?:\/\//, "")}</span><ExternalLink className="size-3 shrink-0" />
        </a>
      ) : dash,
    },
    { id: "visits", header: "Visits", width: 80, align: "right", sortValue: (r) => r.visits, cell: (r) => num(r.visits) },
    { id: "time", header: "Avg time", width: 90, align: "right", sortValue: (r) => r.avgTime, cell: (r) => (r.visits ? duration(r.avgTime) : dash) },
    { id: "bounce", header: "Bounce", width: 80, align: "right", sortValue: (r) => r.bounceRate, cell: (r) => (r.visits ? pct(r.bounceRate, 0) : dash) },
    { id: "play", header: "VSL plays", width: 90, align: "right", sortValue: (r) => r.playRate, cell: (r) => (r.plays ? pct(r.playRate, 0) : dash) },
    { id: "watch", header: "Avg watch", width: 90, align: "right", sortValue: (r) => r.avgWatch, cell: (r) => (r.plays ? duration(r.avgWatch) : dash) },
    { id: "leads", header: "Leads", width: 70, align: "right", sortValue: (r) => r.leads, cell: (r) => num(r.leads) },
    { id: "conv", header: "Conv. rate", width: 90, align: "right", sortValue: (r) => r.convRate, cell: (r) => (r.visits ? pct(r.convRate) : dash) },
    { id: "booked", header: "Booked", width: 70, align: "right", sortValue: (r) => r.booked, cell: (r) => num(r.booked) },
    {
      id: "hit", header: "Last visit", width: 110, sortValue: (r) => r.lastHit ?? "", cell: (r) => r.lastHit
        ? <span className="text-fg-2">{timeAgo(r.lastHit)}</span>
        : <Tag color="yellow">Not installed</Tag>,
    },
  ];

  return (
    <Page>
      <PageHeader icon={Globe} title="Landers" actions={<Button variant="primary" icon={Plug} onClick={() => setConnectOpen(true)}>Connect lander</Button>} />
      <PageBody>
        <div className="px-3 pt-3 text-xs text-fg-3">Last 30 days</div>
        <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-5">
          <Stat label="Visits" value={num(total.visits)} sub={`${num(total.visitors)} unique`} />
          <Stat label="Avg time on page" value={total.visits ? duration(total.avgTime) : "—"} sub={total.visits ? `${pct(total.bounceRate, 0)} bounce` : undefined} />
          <Stat label="VSL avg watch" icon={PlayCircle} value={total.plays ? duration(total.avgWatch) : "—"} sub={total.plays ? `${pct(total.playRate, 0)} pressed play` : undefined} />
          <Stat label="Leads" value={num(total.leads)} sub={total.visits ? `${pct(total.convRate)} conversion` : undefined} />
          <Stat label="Booked calls" value={num(total.booked)} sub={total.leads ? `${pct(total.booked / total.leads, 0)} of leads` : undefined} />
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          onRowClick={(r) => router.push(`/landing-pages/${r.id}`)}
          empty={
            <EmptyState icon={Globe} title="No landers connected"
              description="Connect a page you built (Framer, Webflow, Carrd, your own site) to track visits, VSL watch time and conversions."
              action={<Button variant="primary" icon={Plug} onClick={() => setConnectOpen(true)}>Connect lander</Button>} />
          }
        />
      </PageBody>
      <LanderFormDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </Page>
  );
}
