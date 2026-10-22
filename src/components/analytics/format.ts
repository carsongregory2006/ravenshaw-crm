import { money, num, pct } from "@/lib/utils";

export type Fmt = "money" | "num" | "pct" | "days" | "minutes" | "text" | "x";

export function fmt(v: unknown, f: Fmt = "num", compact = false): string {
  if (v == null || v === "" || (typeof v === "number" && !isFinite(v))) return "—";
  const x = Number(v);
  switch (f) {
    case "money": return money(x, { compact });
    case "pct": return pct(x);
    case "days": return `${x.toFixed(1)} d`;
    case "minutes": return x < 60 ? `${Math.round(x)} min` : x < 1440 ? `${(x / 60).toFixed(1)} h` : `${(x / 1440).toFixed(1)} d`;
    case "x": return `${x.toFixed(2)}×`;
    case "text": return String(v);
    default: return compact && Math.abs(x) >= 1000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(x) : num(Math.round(x * 100) / 100);
  }
}
