"use client";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Bot, Copy, Play } from "lucide-react";
import { Page, PageBody } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { Textarea } from "@/components/ui/input";
import { MarketingHeader } from "@/components/marketing/header";
import { runAgentAction } from "@/lib/actions/marketing";
import { cn } from "@/lib/utils";

type Agent = { id: string; name: string; description: string; input: string };
type Run = { output: string; at: string; input?: string };

export function AgentsView({ agents, last, days, aiReady }: { agents: Agent[]; last: Record<string, Run>; days: number; aiReady: boolean }) {
  const [active, setActive] = React.useState(agents[0].id);
  const [inputs, setInputs] = React.useState<Record<string, string>>(() => Object.fromEntries(agents.map((a) => [a.id, last[a.id]?.input ?? ""])));
  const [runs, setRuns] = React.useState<Record<string, Run>>(last);
  const [busy, setBusy] = React.useState<string | null>(null);
  const agent = agents.find((a) => a.id === active)!;
  const run = runs[active];
  return (
    <Page>
      <MarketingHeader days={days} title="Agents" />
      <PageBody>
        {!aiReady && <p className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">AI isn&apos;t connected (OpenRouter key missing), so agents can&apos;t run.</p>}
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {agents.map((a) => (
              <button key={a.id} onClick={() => setActive(a.id)}
                className={cn("w-full rounded-lg border p-3 text-left cursor-pointer", a.id === active ? "border-accent bg-accent-soft" : "border-border hover:bg-hover")}>
                <div className="flex items-center gap-2 text-[13px] font-semibold"><Bot className="size-4 text-accent" />{a.name}</div>
                <p className="mt-1 text-xs text-fg-3">{a.description}</p>
                {runs[a.id] && <p className="mt-1 text-[11px] text-fg-4">Last run {new Date(runs[a.id].at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</p>}
              </button>
            ))}
          </div>
          <Card title={agent.name} actions={run && <Button size="sm" variant="ghost" icon={Copy} onClick={() => { navigator.clipboard.writeText(run.output); toast.success("Copied"); }}>Copy</Button>}>
            <div className="flex gap-2">
              <Textarea rows={2} value={inputs[active] ?? ""} onChange={(e) => setInputs((x) => ({ ...x, [active]: e.target.value }))} placeholder={agent.input} />
              <Button variant="primary" icon={Play} loading={busy === active} disabled={!aiReady || (agent.id === "copywriter" && !inputs[active]?.trim())} onClick={async () => {
                setBusy(active);
                const r = await runAgentAction(active, days, inputs[active] ?? "");
                setBusy(null);
                if (!r.ok) return toast.error(r.error);
                setRuns((x) => ({ ...x, [active]: { output: r.data.output, at: r.data.at } }));
              }}>Run</Button>
            </div>
            <p className="mt-1 text-xs text-fg-4">Uses your ad numbers from the last {days} days{agent.id === "lessons" ? " — this one reads Past campaigns only" : ""}.</p>
            <div className="mt-4 max-w-none space-y-2 text-[13px] leading-relaxed [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold">
              {busy === active ? <p className="text-fg-3">Thinking…</p> : run ? <ReactMarkdown>{run.output}</ReactMarkdown> : <p className="text-fg-3">Not run yet. Press Run.</p>}
            </div>
          </Card>
        </div>
      </PageBody>
    </Page>
  );
}
