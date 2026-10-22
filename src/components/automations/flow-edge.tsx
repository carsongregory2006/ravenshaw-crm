"use client";
import { useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { Plus, Trash2 } from "lucide-react";
import { useBuilder } from "./context";

export function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected }: EdgeProps) {
  const { openPicker, deleteEdge } = useBuilder();
  const [hover, setHover] = useState(false);
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <g onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={24}
        style={{ stroke: selected || hover ? "var(--accent)" : "var(--border-strong)", strokeWidth: 2 }} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute flex gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: "all", opacity: hover || selected ? 1 : 0 }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <button onClick={() => openPicker({ kind: "between", edgeId: id })} aria-label="Insert step"
            className="flex size-6 items-center justify-center rounded-md border border-border-strong bg-bg text-fg-2 shadow-sm hover:text-accent cursor-pointer">
            <Plus className="size-3.5" />
          </button>
          <button onClick={() => deleteEdge(id)} aria-label="Delete connection"
            className="flex size-6 items-center justify-center rounded-md border border-border-strong bg-bg text-fg-2 shadow-sm hover:text-danger cursor-pointer">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </g>
  );
}
