"use client";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { CATEGORIES, NODE_CATALOG } from "@/lib/automations/catalog";
import type { AutomationNodeType } from "@/lib/types";
import { NODE_ICONS } from "./icons";

export function NodePicker({ onPick, onClose }: { onPick: (t: AutomationNodeType) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const all = (Object.keys(NODE_CATALOG) as AutomationNodeType[]).filter((t) => t !== "trigger");
    const ql = q.toLowerCase();
    return CATEGORIES.map((c) => ({
      category: c,
      items: all.filter((t) => NODE_CATALOG[t].category === c && (!ql || NODE_CATALOG[t].label.toLowerCase().includes(ql) || NODE_CATALOG[t].description.toLowerCase().includes(ql))),
    })).filter((g) => g.items.length);
  }, [q]);

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-border bg-bg shadow-lg">
      <div className="flex h-11 items-center justify-between border-b border-border-light px-3">
        <span className="text-[13px] font-medium">What happens next?</span>
        <button onClick={onClose} className="rounded-sm p-1 text-fg-3 hover:bg-hover cursor-pointer" aria-label="Close"><X className="size-4" /></button>
      </div>
      <div className="border-b border-border-light p-2">
        <div className="flex h-8 items-center gap-2 rounded-md border border-border px-2 focus-within:border-accent">
          <Search className="size-3.5 text-fg-3" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search nodes…"
            onKeyDown={(e) => { if (e.key === "Enter" && groups[0]?.items[0]) onPick(groups[0].items[0]); if (e.key === "Escape") onClose(); }}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-4" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {groups.map((g) => (
          <div key={g.category} className="mb-3">
            <div className="px-2 pb-1 text-xs font-medium text-fg-3">{g.category}</div>
            {g.items.map((t) => {
              const m = NODE_CATALOG[t];
              const I = NODE_ICONS[t];
              return (
                <button key={t} onClick={() => onPick(t)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-hover cursor-pointer">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: m.color + "1f", color: m.color }}><I className="size-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-fg">{m.label}</span>
                    <span className="block truncate text-xs text-fg-3">{m.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {!groups.length && <p className="px-2 py-6 text-center text-[13px] text-fg-3">No nodes match “{q}”.</p>}
      </div>
    </div>
  );
}
