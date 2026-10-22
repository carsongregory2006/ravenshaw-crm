"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_CATALOG, nodeSummary } from "@/lib/automations/catalog";
import { NODE_ICONS } from "./icons";
import { useBuilder, type FlowNode } from "./context";

const handleCls = "!size-2.5 !border-2 !border-bg !bg-fg-3";

function AddButton({ onClick, top }: { onClick: () => void; top: string }) {
  return (
    <div className="nodrag nopan absolute left-full flex items-center" style={{ top, transform: "translateY(-50%)" }}>
      <span className="h-px w-8 bg-border-strong" />
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="flex size-6 items-center justify-center rounded-md border border-border-strong bg-bg text-fg-3 shadow-sm hover:border-accent hover:text-accent cursor-pointer"
        aria-label="Add next step"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function FlowNodeImpl({ id, data, selected }: NodeProps<FlowNode>) {
  const { openPicker, connected, issues } = useBuilder();
  const type = data.nodeType;
  const meta = NODE_CATALOG[type];
  const Icon = NODE_ICONS[type];
  const isTrigger = type === "trigger";
  const isCond = type === "condition";
  const isEnd = type === "end";
  const label = (data.config.label as string) || meta.label;
  const hasIssue = issues.has(id);

  return (
    <div className="group relative">
      {isTrigger && (
        <div className="absolute -top-5 left-0 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[#ff6d5a]">
          <span className="size-1.5 rounded-full bg-[#ff6d5a]" /> When this happens
        </div>
      )}
      <div
        className={cn(
          "flex w-[230px] items-center gap-3 border-2 bg-bg px-3 py-3 shadow-md transition-colors",
          isTrigger ? "rounded-l-[36px] rounded-r-xl pl-4" : isEnd ? "rounded-r-[36px] rounded-l-xl" : "rounded-xl",
          selected ? "border-accent" : hasIssue ? "border-danger" : "border-border hover:border-border-strong",
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: meta.color + "1f", color: meta.color }}>
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-fg">{label}</div>
          <div className="line-clamp-2 text-[11px] leading-snug text-fg-3">{nodeSummary(type, data.config)}</div>
        </div>
      </div>

      {!isTrigger && <Handle type="target" position={Position.Left} className={handleCls} />}

      {isCond ? (
        <>
          <Handle id="yes" type="source" position={Position.Right} style={{ top: "30%" }} className="!size-2.5 !border-2 !border-bg !bg-success" />
          <Handle id="no" type="source" position={Position.Right} style={{ top: "70%" }} className="!size-2.5 !border-2 !border-bg !bg-danger" />
          <span className="pointer-events-none absolute left-full ml-2 text-[10px] font-semibold text-success" style={{ top: "30%", transform: "translateY(-130%)" }}>Yes</span>
          <span className="pointer-events-none absolute left-full ml-2 text-[10px] font-semibold text-danger" style={{ top: "70%", transform: "translateY(30%)" }}>No</span>
          {!connected.has(`${id}:yes`) && <AddButton top="30%" onClick={() => openPicker({ kind: "after", nodeId: id, handle: "yes" })} />}
          {!connected.has(`${id}:no`) && <AddButton top="70%" onClick={() => openPicker({ kind: "after", nodeId: id, handle: "no" })} />}
        </>
      ) : !isEnd ? (
        <>
          <Handle type="source" position={Position.Right} className={handleCls} />
          {!connected.has(`${id}:`) && <AddButton top="50%" onClick={() => openPicker({ kind: "after", nodeId: id })} />}
        </>
      ) : null}
    </div>
  );
}

export const FlowNodeView = memo(FlowNodeImpl);
