"use client";
import { createContext, useContext } from "react";
import type { Node } from "@xyflow/react";
import type { AutomationNodeType } from "@/lib/types";

export type FlowNodeData = { nodeType: AutomationNodeType; config: Record<string, unknown> };
export type FlowNode = Node<FlowNodeData, "auto">;

export type PickTarget =
  | { kind: "after"; nodeId: string; handle?: "yes" | "no" }
  | { kind: "between"; edgeId: string }
  | { kind: "free" };

export interface BuilderCtx {
  openPicker: (t: PickTarget) => void;
  connected: Set<string>;     // `${nodeId}:${handle ?? ""}` for outputs that already have an edge
  issues: Set<string>;        // node ids with validation errors
  deleteEdge: (id: string) => void;
}

export const Ctx = createContext<BuilderCtx | null>(null);
export function useBuilder() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBuilder outside builder");
  return c;
}
