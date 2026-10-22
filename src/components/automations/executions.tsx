"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Ban, CircleAlert, CircleCheck, CircleDashed, Clock, ListTree, Play, RotateCcw, SkipForward } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusTag } from "@/components/ui/badge";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { cancelRunAction, retryRunAction } from "@/lib/actions/automations";
import { NODE_CATALOG } from "@/lib/automations/catalog";
import type { AutomationNode, AutomationRun, AutomationRunLog } from "@/lib/types";
import { cn, contactLabel, fmtDateTime, timeAgo } from "@/lib/utils";
import { NODE_ICONS } from "./icons";

type RunRow = AutomationRun & { contact: { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null };

const FILTERS = [
  { id: "all", label: "All", statuses: null },
  { id: "active", label: "In progress", statuses: ["running", "waiting"] },
  { id: "completed", label: "Completed", statuses: ["completed"] },
  { id: "failed", label: "Failed", statuses: ["failed"] },
  { id: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
] as const;

const logIcon: Record<string, { icon: typeof CircleCheck; cls: string }> = {
  ok: { icon: CircleCheck, cls: "text-success" },
  error: { icon: CircleAlert, cls: "text-danger" },
  skipped: { icon: SkipForward, cls: "text-fg-3" },
  waiting: { icon: Clock, cls: "text-warning" },
};

export function Executions({ automationId, nodes, selectedRunId, onSelectRun }: {
  automationId: string; nodes: AutomationNode[]; selectedRunId: string | null; onSelectRun: (id: string | null) => void;
}) {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [logs, setLogs] = useState<AutomationRunLog[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [pending, start] = useTransition();
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const loadRuns = useCallback(async () => {
    const sb = createClient();
    let q = sb.from("automation_runs").select("*, contact:contacts(id, first_name, last_name, email, phone)")
      .eq("automation_id", automationId).order("started_at", { ascending: false }).limit(200);
    const f = FILTERS.find((x) => x.id === filter);
    if (f?.statuses) q = q.in("status", f.statuses as unknown as string[]);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRuns((data as RunRow[]) ?? []);
  }, [automationId, filter]);

  const loadLogs = useCallback(async () => {
    if (!selectedRunId) return setLogs([]);
    const { data } = await createClient().from("automation_run_logs").select("*").eq("run_id", selectedRunId).order("created_at");
    setLogs((data as AutomationRunLog[]) ?? []);
  }, [selectedRunId]);

  useEffect(() => { loadRuns(); const t = setInterval(loadRuns, 4000); return () => clearInterval(t); }, [loadRuns]);
  useEffect(() => { loadLogs(); const t = setInterval(loadLogs, 3000); return () => clearInterval(t); }, [loadLogs]);

  const run = runs?.find((r) => r.id === selectedRunId) ?? null;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => {
    const r = await fn();
    if (!r.ok) return void toast.error(r.error);
    toast.success(msg);
    loadRuns(); loadLogs();
  });

  const stepName = (id: string | null) => {
    const n = id ? nodeById.get(id) : null;
    return n ? ((n.data?.label as string) || NODE_CATALOG[n.type].label) : id ? "(deleted step)" : "—";
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[380px] shrink-0 flex-col border-r border-border">
        <div className="flex gap-1 overflow-x-auto border-b border-border-light p-2">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={cn("h-6 shrink-0 rounded-md px-2 text-xs cursor-pointer", filter === f.id ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover")}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {runs === null ? <div className="flex justify-center py-10"><Spinner /></div> : runs.length === 0 ? (
            <EmptyState icon={ListTree} title="No executions yet" description="Activate the workflow or use “Test” to run it on a contact." />
          ) : (
            <ul>
              {runs.map((r) => (
                <li key={r.id}>
                  <button onClick={() => onSelectRun(r.id)}
                    className={cn("flex w-full flex-col gap-1 border-b border-border-light px-3 py-2 text-left cursor-pointer", r.id === selectedRunId ? "bg-accent-soft/60" : "hover:bg-hover")}>
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{r.contact ? contactLabel(r.contact) : "No contact"}</span>
                      {(r.context as Record<string, unknown>)?.test ? <span className="rounded-sm bg-bg-3 px-1 text-[10px] text-fg-3">TEST</span> : null}
                      <span className="ml-auto"><StatusTag status={r.status} /></span>
                    </span>
                    <span className="flex justify-between text-xs text-fg-3">
                      <span className="truncate">
                        {r.status === "waiting" ? `Next: ${stepName(r.current_node_id)} · ${timeAgo(r.next_run_at)}` : r.status === "failed" ? `Failed at ${stepName(r.current_node_id)}` : r.error || stepName(r.current_node_id)}
                      </span>
                      <span className="shrink-0 pl-2">{timeAgo(r.started_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {!run ? (
          <EmptyState icon={CircleDashed} title="Select an execution" description="See every step a contact went through, with timestamps and errors." className="h-full" />
        ) : (
          <div className="mx-auto max-w-2xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">
                {run.contact ? <Link href={`/contacts/${run.contact.id}`} className="hover:underline">{contactLabel(run.contact)}</Link> : "No contact"}
              </h2>
              <StatusTag status={run.status} />
              <div className="ml-auto flex gap-1.5">
                {run.status === "waiting" && (
                  <Button icon={Play} loading={pending} onClick={() => act(() => retryRunAction(run.id), "Running next step now")}>Run next step now</Button>
                )}
                {(run.status === "failed" || (run.status === "cancelled" && run.current_node_id)) && (
                  <Button icon={RotateCcw} loading={pending} onClick={() => act(() => retryRunAction(run.id), "Run resumed")}>
                    {run.status === "failed" ? "Retry failed step" : "Resume"}
                  </Button>
                )}
                {(run.status === "running" || run.status === "waiting") && (
                  <Button variant="secondary" icon={Ban} loading={pending} onClick={() => act(() => cancelRunAction(run.id), "Run cancelled")}>Cancel</Button>
                )}
              </div>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-fg-3">
              <span>Started {fmtDateTime(run.started_at)}</span>
              <span>{run.finished_at ? `Finished ${fmtDateTime(run.finished_at)}` : run.status === "waiting" ? `Resumes ${fmtDateTime(run.next_run_at)}` : "In progress"}</span>
              <span>Trigger: {String((run.context as Record<string, unknown>)?.event ?? "—")}</span>
              <span>Current step: {stepName(run.current_node_id)}</span>
            </div>
            {run.error && <div className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{run.error}</div>}

            <ol className="relative mt-5 space-y-0 border-l border-border pl-5">
              {logs.map((l) => {
                const n = l.node_id ? nodeById.get(l.node_id) : null;
                const st = logIcon[l.status] ?? logIcon.ok;
                const NodeIcon = n ? NODE_ICONS[n.type] : null;
                return (
                  <li key={l.id} className="relative pb-4">
                    <span className="absolute -left-[27px] top-0.5 flex size-3.5 items-center justify-center rounded-full bg-bg">
                      <st.icon className={cn("size-3.5", st.cls)} />
                    </span>
                    <div className="flex items-center gap-2 text-[13px]">
                      {NodeIcon && n && <NodeIcon className="size-3.5" style={{ color: NODE_CATALOG[n.type].color }} />}
                      <span className="font-medium">{l.node_id ? stepName(l.node_id) : "System"}</span>
                      <span className="ml-auto text-xs text-fg-4">{fmtDateTime(l.created_at)}</span>
                    </div>
                    {l.message && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-fg-2">{l.message}</p>}
                  </li>
                );
              })}
              {!logs.length && <li className="text-xs text-fg-3">No steps logged yet.</li>}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
