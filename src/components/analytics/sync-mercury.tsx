"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncMercuryNow } from "@/lib/actions/finance";

export function SyncMercuryButton({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button icon={RefreshCw} loading={pending} disabled={!configured} title={configured ? "Pull latest Mercury transactions & invoice statuses" : "Add MERCURY_API_KEY to enable"}
      onClick={() => start(async () => {
        const r = await syncMercuryNow();
        if (!r.ok) { toast.error(r.error); return; }
        const s = r.data as unknown as Record<string, unknown>;
        const parts = Object.entries(s).filter(([, v]) => typeof v === "number").map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, " $1").toLowerCase()}`);
        const errs = Array.isArray(s.errors) ? (s.errors as string[]) : [];
        if (errs.length) toast.warning(`Synced with issues: ${errs[0]}`); else toast.success(`Mercury synced${parts.length ? ": " + parts.join(", ") : ""}`);
        router.refresh();
      })}>Sync Mercury</Button>
  );
}
