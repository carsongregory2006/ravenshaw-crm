"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { EditScope } from "@/lib/actions/calendar";

export function ScopeDialog({ open, verb, onCancel, onConfirm }: { open: boolean; verb: "Edit" | "Delete"; onCancel: () => void; onConfirm: (s: EditScope) => void }) {
  const [scope, setScope] = useState<EditScope>("single");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()} size="sm" title={`${verb} recurring event`}
      footer={<><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="primary" onClick={() => onConfirm(scope)}>OK</Button></>}>
      <div className="space-y-2 py-1">
        {([["single", "This event"], ["all", "All events"]] as const).map(([v, l]) => (
          <label key={v} className="flex cursor-pointer items-center gap-3 text-[13px]">
            <input type="radio" name="scope" checked={scope === v} onChange={() => setScope(v)} className="size-4 accent-[#1a73e8]" />
            {l}
          </label>
        ))}
      </div>
    </Dialog>
  );
}
