"use client";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const SLOTS = Array.from({ length: 96 }, (_, i) => i * 15);
const label = (min: number) => format(new Date(2000, 0, 1, Math.floor(min / 60), min % 60), "h:mma").toLowerCase();
export const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
export const toHHMM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function durLabel(mins: number) {
  if (mins < 60) return `${mins} mins`;
  const h = mins / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, "")} hr${h === 1 ? "" : "s"}`;
}

/** Google-style 15-minute time dropdown. When `from` is set, shows durations (end-time picker). */
export function TimeSelect({ value, onChange, from, className }: { value: string; onChange: (v: string) => void; from?: string; className?: string }) {
  const cur = toMin(value);
  const fromMin = from != null ? toMin(from) : null;
  const opts = fromMin != null ? SLOTS.filter((m) => m > fromMin) : SLOTS;
  const all = opts.includes(cur) ? opts : [...opts, cur].sort((a, b) => a - b);
  return (
    <select
      value={cur}
      onChange={(e) => onChange(toHHMM(Number(e.target.value)))}
      className={cn("h-9 rounded-md border border-transparent bg-bg-3 px-2 text-[13px] text-fg hover:border-border focus:border-accent focus:outline-none cursor-pointer", className)}
    >
      {all.map((m) => (
        <option key={m} value={m}>{label(m)}{fromMin != null ? ` (${durLabel(m - fromMin)})` : ""}</option>
      ))}
    </select>
  );
}
