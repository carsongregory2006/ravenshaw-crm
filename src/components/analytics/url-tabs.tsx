"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, type TabDef } from "@/components/ui/tabs";

/** Tabs bound to ?tab= so server pages can render per-tab data and links are shareable. */
export function UrlTabs({ tabs, value, right }: { tabs: { id: string; label: string; count?: number }[]; value: string; right?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Tabs tabs={tabs as TabDef[]} value={value} right={right} onChange={(id) => {
      const q = new URLSearchParams(params.toString());
      q.set("tab", id);
      router.push(`${pathname}?${q}`);
    }} />
  );
}
