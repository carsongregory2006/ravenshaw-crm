"use client";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { GripVertical, Lock, Plus, Trash2 } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Tag, type TagColor } from "@/components/ui/badge";
import { deleteStage, reorderStages, saveStage } from "@/lib/actions/settings";
import type { PipelineStage } from "@/lib/types";
import { PageTitle, Section } from "./section";

const COLORS: TagColor[] = ["gray", "blue", "sky", "purple", "orange", "yellow", "green", "red", "pink", "turquoise"];

function StageRow({ stage, count }: { stage: PipelineStage; count: number }) {
  const locked = stage.is_won || stage.is_lost;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id, disabled: locked });
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color);
  const [prob, setProb] = useState(String(stage.probability));
  const [busy, start] = useTransition();
  const dirty = name !== stage.name || color !== stage.color || Number(prob) !== stage.probability;

  const save = () => start(async () => {
    if (!name.trim()) return void toast.error("Stage name is required");
    const r = await saveStage({ id: stage.id, name: name.trim(), color, probability: Math.min(100, Math.max(0, parseInt(prob) || 0)) });
    if (r.ok) toast.success("Stage saved"); else toast.error(r.error);
  });
  const remove = () => start(async () => {
    if (!confirm(`Delete stage "${stage.name}"?`)) return;
    const r = await deleteStage(stage.id);
    if (r.ok) toast.success("Stage deleted"); else toast.error(r.error);
  });

  return (
    <div ref={setNodeRef} style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}
      className={`flex items-center gap-2 border-b border-border-light bg-bg px-2 py-1.5 last:border-0 ${isDragging ? "relative z-10 shadow-md" : ""}`}>
      {locked
        ? <span className="flex w-6 justify-center text-fg-4" title="Won/Lost stages are fixed"><Lock className="size-3.5" /></span>
        : <button {...attributes} {...listeners} className="flex w-6 cursor-grab justify-center text-fg-4 hover:text-fg-2" aria-label="Drag to reorder"><GripVertical className="size-4" /></button>}
      <Tag color={color} className="w-24 justify-center">{name || "—"}</Tag>
      <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 flex-1" />
      <Select value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-28">
        {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
      </Select>
      <div className="relative w-20">
        <Input type="number" min={0} max={100} value={prob} disabled={locked} onChange={(e) => setProb(e.target.value)} className="h-7 pr-5 text-right" title="Win probability (weighted pipeline)" />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-fg-3">%</span>
      </div>
      <span className="w-14 text-right text-xs text-fg-3">{count} deal{count === 1 ? "" : "s"}</span>
      <Button size="xs" variant={dirty ? "primary" : "ghost"} disabled={!dirty} loading={busy} onClick={save}>Save</Button>
      <Button size="xs" variant="ghost" icon={Trash2} disabled={locked || count > 0 || busy} onClick={remove}
        title={locked ? "Won/Lost can't be deleted" : count > 0 ? "Move deals out of this stage first" : "Delete stage"} aria-label="Delete stage" />
    </div>
  );
}

export function PipelineSettings({ stages: initial, counts }: { stages: PipelineStage[]; counts: Record<string, number> }) {
  const [stages, setStages] = useState(initial);
  useEffect(() => setStages(initial), [initial]);
  const [newName, setNewName] = useState("");
  const [busy, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const open = stages.filter((s) => !s.is_won && !s.is_lost);
  const closed = stages.filter((s) => s.is_won || s.is_lost);

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = open.findIndex((s) => s.id === e.active.id);
    const to = open.findIndex((s) => s.id === e.over!.id);
    if (from < 0 || to < 0) return;
    const next = [...arrayMove(open, from, to), ...closed];
    setStages(next);
    start(async () => {
      const r = await reorderStages(next.map((s) => s.id));
      if (r.ok) toast.success("Order saved"); else { toast.error(r.error); setStages(initial); }
    });
  };

  const add = () => start(async () => {
    if (!newName.trim()) return;
    const r = await saveStage({ name: newName.trim(), color: "gray", probability: 50 });
    if (r.ok) { toast.success("Stage added"); setNewName(""); } else toast.error(r.error);
  });

  return (
    <>
      <PageTitle title="Pipeline" description="Deal stages shown on the Deals board, in order." />
      <Section title="Stages" description="Drag to reorder. Probability drives the weighted pipeline forecast. Won and Lost are fixed and close the deal.">
        <div className="overflow-hidden rounded-lg border border-border">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={open.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {open.map((s) => <StageRow key={s.id + s.name + s.color + s.probability} stage={s} count={counts[s.id] ?? 0} />)}
            </SortableContext>
            <div className="border-t border-border bg-bg-2 px-3 py-1 text-xs text-fg-3">Closed</div>
            {closed.map((s) => <StageRow key={s.id + s.name + s.color} stage={s} count={counts[s.id] ?? 0} />)}
          </DndContext>
        </div>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New stage name (added before Won)…" />
          <Button type="submit" icon={Plus} loading={busy} disabled={!newName.trim()}>Add stage</Button>
        </form>
      </Section>
    </>
  );
}
