"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";

export function ParamSelect({ param, value, options, label }: { param: string; value: string; options: { value: string; label: string }[]; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-fg-3">
      {label}
      <Select className="h-7 w-auto" value={value} onChange={(e) => {
        const q = new URLSearchParams(params.toString());
        q.set(param, e.target.value);
        router.push(`${pathname}?${q}`);
      }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </label>
  );
}
