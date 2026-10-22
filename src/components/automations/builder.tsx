"use client";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, MarkerType, Panel,
  applyEdgeChanges, applyNodeChanges, useReactFlow,
  type Connection, type Edge, type EdgeChange, type NodeChange,
} from "@xyflow/react";
import { toast } from "sonner";
import { ArrowLeft, Check, LayoutGrid, Loader2, Play, Plus, Save, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/input";
import { StatusTag } from "@/components/ui/badge";
import { saveAutomation, setAutomationStatus, testAutomationAction } from "@/lib/actions/automations";
import { NODE_CATALOG } from "@/lib/automations/catalog";
import { validateGraph } from "@/lib/automations/validate";
import type { Automation, AutomationEdge, AutomationNode, AutomationNodeType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Ctx, type FlowNode, type PickTarget } from "./context";
import { FlowNodeView } from "./flow-node";
import { FlowEdgeView } from "./flow-edge";
import { NodePicker } from "./node-picker";
import { ConfigPanel, type Lookups } from "./config-panel";
import { Executions } from "./executions";
import { TestDialog } from "./test-dialog";

const nodeTypes = { auto: FlowNodeView };
const edgeTypes = { auto: FlowEdgeView };
const GAP_X = 300;
const GAP_Y = 140;
const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--border-strong)" };

const toFlowNodes = (nodes: AutomationNode[]): FlowNode[] =>
  nodes.map((n) => ({ id: n.id, type: "auto", position: n.position ?? { x: 0, y: 0 }, data: { nodeType: n.type, config: n.data ?? {} }, deletable: n.type !== "trigger" }));
const toFlowEdges = (edges: AutomationEdge[]): Edge[] =>
  edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, type: "auto", markerEnd: marker }));
const fromFlowNodes = (nodes: FlowNode[]): AutomationNode[] =>
  nodes.map((n) => ({ id: n.id, type: n.data.nodeType, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data.config }));
const fromFlowEdges = (edges: Edge[]): AutomationEdge[] =>
  edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null }));

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

/** Tidy left-to-right tree layout from the trigger (condition: Yes above, No below). */
function autoLayout(nodes: FlowNode[], edges: Edge[]): FlowNode[] {
  const pos = new Map<string, { x: number; y: number }>();
  const order = (id: string) => {
    const out = edges.filter((e) => e.source === id);
    return [...out.filter((e) => e.sourceHandle === "yes"), ...out.filter((e) => !e.sourceHandle), ...out.filter((e) => e.sourceHandle === "no")].map((e) => e.target);
  };
  const place = (id: string, depth: number, slot: number): number => {
    pos.set(id, { x: depth * GAP_X, y: 0 });
    const kids = order(id).filter((k) => !pos.has(k));
    let cur = slot;
    if (!kids.length) { pos.get(id)!.y = slot * GAP_Y; return slot + 1; }
    for (const k of kids) cur = place(k, depth + 1, cur);
    pos.get(id)!.y = ((slot + cur - 1) / 2) * GAP_Y;
    return cur;
  };
  const trigger = nodes.find((n) => n.data.nodeType === "trigger");
  let next = trigger ? place(trigger.id, 0, 0) : 0;
  for (const n of nodes) if (!pos.has(n.id)) next = place(n.id, 0, next);
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
}

type SaveState = "saved" | "dirty" | "saving" | "invalid";

function Canvas({ automation, lookups, initialTab }: { automation: Automation; lookups: Lookups; initialTab: "editor" | "executions" }) {
  const router = useRouter();
  const rf = useReactFlow<FlowNode, Edge>();
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(automation.nodes));
  const [edges, setEdges] = useState<Edge[]>(() => toFlowEdges(automation.edges));
  const [name, setName] = useState(automation.name);
  const [allowReentry, setAllowReentry] = useState(automation.allow_reentry);
  const [status, setStatus] = useState(automation.status);
  const [tab, setTab] = useState<"editor" | "executions">(initialTab);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickTarget | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [showIssues, setShowIssues] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirtyRef = useRef(0);

  // Initial view frames the start of the flow (trigger + first steps) at a readable zoom, like n8n.
  const initialFit = useMemo(() => ({
    padding: 0.15, maxZoom: 1, minZoom: 0.6,
    nodes: [...automation.nodes].sort((a, b) => a.position.x - b.position.x).slice(0, 6).map((n) => ({ id: n.id })),
  }), [automation.nodes]);

  const markDirty = useCallback(() => { dirtyRef.current++; setSaveState("dirty"); }, []);

  const graph = useMemo(() => ({ nodes: fromFlowNodes(nodes), edges: fromFlowEdges(edges) }), [nodes, edges]);
  const issues = useMemo(() => validateGraph(graph.nodes, graph.edges), [graph]);
  const issueNodes = useMemo(() => new Set(showIssues ? issues.map((i) => i.nodeId).filter(Boolean) as string[] : []), [issues, showIssues]);
  const connected = useMemo(() => new Set(edges.map((e) => `${e.source}:${e.sourceHandle ?? ""}`)), [edges]);
  const aiVars = useMemo(() => nodes.filter((n) => n.data.nodeType === "ai_generate" && n.data.config.variable).map((n) => String(n.data.config.variable)), [nodes]);

  // ── persistence ──
  const save = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (status === "active" && issues.length) {
      setSaveState("invalid");
      setShowIssues(true);
      if (!opts.silent) toast.error("Fix the highlighted steps before saving a live workflow", { description: issues[0].message });
      return false;
    }
    const version = dirtyRef.current;
    setSaveState("saving");
    const r = await saveAutomation(automation.id, { name, nodes: graph.nodes, edges: graph.edges, allow_reentry: allowReentry });
    if (!r.ok) {
      setSaveState("dirty");
      toast.error(r.error);
      return false;
    }
    setSaveState(dirtyRef.current === version ? "saved" : "dirty");
    if (!opts.silent) toast.success("Workflow saved");
    return true;
  }, [automation.id, name, graph, allowReentry, status, issues]);

  // autosave 1.5s after the last meaningful change
  useEffect(() => {
    if (saveState !== "dirty") return;
    const t = setTimeout(() => { save({ silent: true }); }, 1500);
    return () => clearTimeout(t);
  }, [saveState, save, nodes, edges, name, allowReentry]);

  // warn before leaving with unsaved changes
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (saveState === "dirty" || saveState === "saving") e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [saveState]);

  // ── graph editing ──
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (changes.some((c) => c.type === "remove" || c.type === "add" || (c.type === "position" && c.dragging === false))) markDirty();
  }, [markDirty]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some((c) => c.type === "remove" || c.type === "add")) markDirty();
  }, [markDirty]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target) return;
    setEdges((es) => [
      // one outgoing connection per output handle
      ...es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null))),
      { id: uid("e"), source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? null, type: "auto", markerEnd: marker },
    ]);
    markDirty();
  }, [markDirty]);

  const deleteEdge = useCallback((id: string) => { setEdges((es) => es.filter((e) => e.id !== id)); markDirty(); }, [markDirty]);

  /** Remove nodes; bridge a simple in→out chain so sequences stay connected. */
  const removeNodes = useCallback((ids: string[]) => {
    const kill = new Set(ids.filter((id) => nodes.find((n) => n.id === id)?.data.nodeType !== "trigger"));
    if (!kill.size) return;
    setEdges((es) => {
      const bridges: Edge[] = [];
      for (const id of kill) {
        const ins = es.filter((e) => e.target === id && !kill.has(e.source));
        const outs = es.filter((e) => e.source === id && !kill.has(e.target));
        if (ins.length === 1 && outs.length === 1) {
          const inc = ins[0];
          bridges.push({ id: uid("e"), source: inc.source, sourceHandle: inc.sourceHandle ?? null, target: outs[0].target, type: "auto", markerEnd: marker });
        }
      }
      return [...es.filter((e) => !kill.has(e.source) && !kill.has(e.target)), ...bridges];
    });
    setNodes((ns) => ns.filter((n) => !kill.has(n.id)));
    if (selectedId && kill.has(selectedId)) setSelectedId(null);
    markDirty();
  }, [nodes, selectedId, markDirty]);

  const onBeforeDelete = useCallback(async ({ nodes: dn, edges: de }: { nodes: FlowNode[]; edges: Edge[] }) => {
    if (dn.length) { removeNodes(dn.map((n) => n.id)); return false; } // handled ourselves (with bridging)
    return { nodes: [], edges: de };
  }, [removeNodes]);

  const addNode = useCallback((type: AutomationNodeType, target: PickTarget) => {
    const id = uid(type.replace(/_/g, ""));
    const data = { nodeType: type, config: structuredClone(NODE_CATALOG[type].defaults) };
    let position = { x: 0, y: 0 };
    let newEdges = edges;
    let shiftFrom: string | null = null;

    if (target.kind === "after") {
      const src = nodes.find((n) => n.id === target.nodeId)!;
      position = { x: src.position.x + GAP_X, y: src.position.y + (target.handle === "yes" ? -GAP_Y / 1.2 : target.handle === "no" ? GAP_Y / 1.2 : 0) };
      newEdges = [...edges.filter((e) => !(e.source === src.id && (e.sourceHandle ?? null) === (target.handle ?? null))),
        { id: uid("e"), source: src.id, sourceHandle: target.handle ?? null, target: id, type: "auto", markerEnd: marker }];
    } else if (target.kind === "between") {
      const e = edges.find((x) => x.id === target.edgeId);
      if (!e) return;
      const src = nodes.find((n) => n.id === e.source)!;
      position = { x: src.position.x + GAP_X, y: src.position.y + (e.sourceHandle === "yes" ? -GAP_Y / 1.2 : e.sourceHandle === "no" ? GAP_Y / 1.2 : 0) };
      shiftFrom = e.target;
      newEdges = [...edges.filter((x) => x.id !== e.id),
        { id: uid("e"), source: e.source, sourceHandle: e.sourceHandle ?? null, target: id, type: "auto", markerEnd: marker },
        ...(type === "end" ? [] : [{ id: uid("e"), source: id, sourceHandle: type === "condition" ? "yes" : null, target: e.target, type: "auto", markerEnd: marker }])];
    } else {
      const el = document.querySelector(".react-flow");
      const r = el?.getBoundingClientRect();
      position = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2 - 115, y: r.top + r.height / 2 - 30 }) : { x: 0, y: 0 };
    }

    // push downstream nodes right to make room when inserting between
    let shifted = nodes;
    if (shiftFrom) {
      const down = new Set<string>([shiftFrom]);
      const q = [shiftFrom];
      while (q.length) { const cur = q.shift()!; for (const ed of newEdges.filter((x) => x.source === cur)) if (!down.has(ed.target) && ed.target !== id) { down.add(ed.target); q.push(ed.target); } }
      shifted = nodes.map((n) => (down.has(n.id) ? { ...n, position: { ...n.position, x: n.position.x + GAP_X } } : n));
    }

    setNodes([...shifted.map((n) => ({ ...n, selected: false })), { id, type: "auto", position, data, selected: true }]);
    setEdges(newEdges);
    setPicker(null);
    setSelectedId(id);
    markDirty();
    setTimeout(() => rf.fitView({ nodes: [{ id }], maxZoom: 1, duration: 300, padding: 2 }), 50);
  }, [nodes, edges, rf, markDirty]);

  const updateConfig = useCallback((id: string, patch: Record<string, unknown>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } } : n)));
    markDirty();
  }, [markDirty]);

  const tidy = () => {
    setNodes((ns) => autoLayout(ns, edges));
    markDirty();
    setTimeout(() => rf.fitView({ duration: 300, padding: 0.15, maxZoom: 1, minZoom: 0.6 }), 50);
  };

  // ── status / test ──
  const changeStatus = (next: Automation["status"]) => start(async () => {
    if (next === "active" && issues.length) {
      setShowIssues(true);
      setTab("editor");
      toast.error("Can't activate yet", { description: issues.slice(0, 3).map((i) => i.message).join("\n") });
      const first = issues.find((i) => i.nodeId);
      if (first?.nodeId) setSelectedId(first.nodeId);
      return;
    }
    if (saveState !== "saved" && !(await save({ silent: true }))) return;
    const r = await setAutomationStatus(automation.id, next);
    if (!r.ok) return void toast.error(r.error);
    setStatus(next);
    toast.success(next === "active" ? "Workflow is live — new matching events will enroll contacts" : next === "paused" ? "Workflow paused — in-flight runs are held" : "Moved to draft");
    router.refresh();
  });

  const runTest = (contactId: string, skipWaits: boolean) => start(async () => {
    if (issues.length) {
      setShowIssues(true);
      toast.error("Fix the highlighted steps before testing", { description: issues[0].message });
      setTestOpen(false);
      return;
    }
    if (saveState !== "saved" && !(await save({ silent: true }))) return;
    const r = await testAutomationAction(automation.id, contactId, skipWaits);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Test run started");
    setTestOpen(false);
    setRunId(r.data);
    setTab("executions");
  });

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const ctx = useMemo(() => ({ openPicker: (t: PickTarget) => { setPicker(t); }, connected, issues: issueNodes, deleteEdge }), [connected, issueNodes, deleteEdge]);

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col">
        {/* top bar */}
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <Link href="/automations" className="rounded-md p-1 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Back to automations"><ArrowLeft className="size-4" /></Link>
          <Workflow className="size-4 text-fg-3" />
          <input value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} aria-label="Workflow name"
            className="h-7 w-64 min-w-0 rounded-md bg-transparent px-1.5 text-[13px] font-medium outline-none hover:bg-hover focus:bg-hover" />
          <StatusTag status={status} />
          <span className="flex items-center gap-1 text-xs text-fg-3">
            {saveState === "saving" ? <><Loader2 className="size-3 animate-spin" /> Saving…</> :
              saveState === "saved" ? <><Check className="size-3" /> Saved</> :
              saveState === "invalid" ? <span className="text-danger">Unsaved — fix errors</span> : "Unsaved changes"}
          </span>

          <div className="mx-auto flex items-center rounded-md bg-bg-3 p-0.5">
            {(["editor", "executions"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={cn("h-6 rounded-[5px] px-3 text-xs font-medium capitalize cursor-pointer", tab === t ? "bg-bg text-fg shadow-sm" : "text-fg-3 hover:text-fg")}>
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <Button icon={Play} onClick={() => setTestOpen(true)}>Test</Button>
            <label className="flex items-center gap-1.5 rounded-md border border-border px-2 h-7 text-[13px]">
              <span className={status === "active" ? "text-success font-medium" : "text-fg-2"}>{status === "active" ? "Active" : "Inactive"}</span>
              <Switch checked={status === "active"} disabled={pending} onChange={(v) => changeStatus(v ? "active" : "paused")} />
            </label>
            <Button variant="primary" icon={Save} loading={saveState === "saving"} onClick={() => save()}>Save</Button>
          </div>
        </header>

        {tab === "executions" ? (
          <Executions automationId={automation.id} nodes={graph.nodes} selectedRunId={runId} onSelectRun={setRunId} />
        ) : (
          <div className="relative min-h-0 flex-1">
            <ReactFlow<FlowNode, Edge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onBeforeDelete={onBeforeDelete}
              onNodeClick={(_, n) => { setSelectedId(n.id); setPicker(null); }}
              onPaneClick={() => { setSelectedId(null); setPicker(null); }}
              deleteKeyCode={["Backspace", "Delete"]}
              defaultEdgeOptions={{ type: "auto", markerEnd: marker }}
              fitView
              fitViewOptions={initialFit}
              minZoom={0.2}
              maxZoom={1.75}
              proOptions={{ hideAttribution: true }}
              className="bg-bg-2"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="var(--border-strong)" />
              <Controls showInteractive={false} position="bottom-left" className="!shadow-md [&>button]:!border-border [&>button]:!bg-bg [&>button]:!fill-fg-2" />
              <MiniMap pannable zoomable position="bottom-right" className="!bg-bg !border !border-border !rounded-lg"
                nodeColor={(n) => NODE_CATALOG[(n as FlowNode).data.nodeType]?.color ?? "#999"} maskColor="rgba(0,0,0,0.06)" />
              <Panel position="top-left" className="flex gap-1.5">
                <Button icon={Plus} onClick={() => setPicker({ kind: "free" })}>Add step</Button>
                <Button icon={LayoutGrid} onClick={tidy}>Tidy up</Button>
                {issues.length > 0 && (
                  <Button variant="ghost" className="text-danger" onClick={() => { setShowIssues(true); const f = issues.find((i) => i.nodeId); if (f?.nodeId) setSelectedId(f.nodeId); else toast.error(issues[0].message); }}>
                    {issues.length} issue{issues.length > 1 ? "s" : ""}
                  </Button>
                )}
              </Panel>
            </ReactFlow>

            {picker && <NodePicker onClose={() => setPicker(null)} onPick={(t) => addNode(t, picker)} />}
            {!picker && selected && (
              <ConfigPanel
                key={selected.id}
                nodeId={selected.id}
                type={selected.data.nodeType}
                config={selected.data.config}
                onChange={(patch) => updateConfig(selected.id, patch)}
                onDelete={() => removeNodes([selected.id])}
                onClose={() => setSelectedId(null)}
                lookups={lookups}
                aiVars={aiVars}
                allowReentry={allowReentry}
                onAllowReentry={(v) => { setAllowReentry(v); markDirty(); }}
                issues={showIssues ? issues.filter((i) => i.nodeId === selected.id).map((i) => i.message) : []}
              />
            )}
          </div>
        )}
      </div>
      <TestDialog open={testOpen} onOpenChange={setTestOpen} onRun={runTest} running={pending} />
    </Ctx.Provider>
  );
}

export function AutomationBuilder(props: { automation: Automation; lookups: Lookups; initialTab: "editor" | "executions" }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
