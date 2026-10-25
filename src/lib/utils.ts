import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function money(n: number | string | null | undefined, opts: { cents?: boolean; compact?: boolean } = {}) {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    notation: opts.compact ? "compact" : "standard",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : opts.compact ? 1 : 0,
  }).format(v);
}

export function pct(n: number | null | undefined, digits = 1) {
  if (n == null || !isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(Number(n ?? 0));
}

export function fullName(p?: { first_name?: string | null; last_name?: string | null } | null) {
  if (!p) return "";
  return [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
}

export function contactLabel(c?: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null) {
  return fullName(c) || c?.email || c?.phone || "Unnamed";
}

export function initials(name?: string | null) {
  if (!name) return "?";
  if (!/[a-z]/i.test(name)) return "#"; // phone numbers etc.
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** Parses YYYY-MM-DD as a local calendar date (not UTC midnight, which shifts a day west of UTC). */
export function parseDate(d: string | Date) {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  return new Date(d);
}

export function fmtDate(d?: string | Date | null, f = "MMM d, yyyy") {
  if (!d) return "—";
  return format(parseDate(d), f);
}

export function fmtDateTime(d?: string | Date | null) {
  if (!d) return "—";
  return format(new Date(d), "MMM d, yyyy h:mm a");
}

export function timeAgo(d?: string | Date | null) {
  if (!d) return "—";
  return formatDistanceToNowStrict(new Date(d), { addSuffix: true });
}

/** Short timestamp for feeds: "3:14 PM", "Yesterday", "Mar 4" */
export function feedTime(d?: string | Date | null) {
  if (!d) return "";
  const date = new Date(d);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, date.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy");
}

/** Normalize a US-centric phone to E.164. */
export function toE164(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : null;
}

export function fmtPhone(phone?: string | null) {
  if (!phone) return "";
  const m = phone.replace(/\D/g, "").match(/^1?(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

const AREA_CITY: Record<string, string> = {
  "613": "Ottawa", "343": "Ottawa", "753": "Ottawa",
  "416": "Toronto", "647": "Toronto", "437": "Toronto", "942": "Toronto",
  "905": "GTA", "289": "GTA", "365": "GTA", "742": "GTA",
  "604": "Vancouver", "778": "BC", "236": "BC", "672": "BC", "250": "BC",
  "403": "Calgary", "780": "Edmonton", "587": "Alberta", "825": "Alberta", "368": "Alberta",
  "204": "Winnipeg", "431": "Winnipeg", "306": "Saskatchewan", "639": "Saskatchewan",
  "514": "Montreal", "438": "Montreal", "902": "Maritimes", "782": "Maritimes", "709": "Newfoundland",
  "519": "SW Ontario", "226": "SW Ontario", "548": "SW Ontario", "705": "Ontario", "249": "Ontario", "807": "NW Ontario",
};

const AREA_PROVINCE: Record<string, string> = {
  ...Object.fromEntries(["613", "343", "753", "416", "647", "437", "942", "905", "289", "365", "742", "519", "226", "548", "705", "249", "807", "683"].map((a) => [a, "ON"])),
  ...Object.fromEntries(["604", "778", "236", "672", "250"].map((a) => [a, "BC"])),
  ...Object.fromEntries(["403", "780", "587", "825", "368"].map((a) => [a, "AB"])),
  ...Object.fromEntries(["204", "431", "584"].map((a) => [a, "MB"])),
  ...Object.fromEntries(["306", "639", "474"].map((a) => [a, "SK"])),
  ...Object.fromEntries(["514", "438", "450", "579", "418", "581", "819", "873", "367", "263", "354", "468"].map((a) => [a, "QC"])),
  ...Object.fromEntries(["902", "782", "506", "428", "709", "879"].map((a) => [a, "ATL"])),
};

export function areaCode(phone?: string | null) {
  return (phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").slice(0, 3);
}

/** Short name for one of our phone lines, e.g. "Toronto · (647) 691-4341". */
export function lineLabel(phone?: string | null) {
  if (!phone) return "";
  const city = AREA_CITY[areaCode(phone)];
  return city ? `${city} · ${fmtPhone(phone)}` : fmtPhone(phone);
}

/** Local presence: our line with the lead's area code, else the same city, else the same province, else the fallback. */
export function localLine(leadPhone: string | null | undefined, lines: string[], fallback: string | null): string | null {
  const area = areaCode(leadPhone);
  if (!area) return fallback;
  const exact = lines.find((l) => areaCode(l) === area);
  if (exact) return exact;
  // Suburban/overlay codes count as their metro (905 → Toronto, 778 → Vancouver).
  const metro = (a: string) => ({ GTA: "Toronto", BC: "Vancouver" } as Record<string, string>)[AREA_CITY[a]] ?? AREA_CITY[a];
  const city = metro(area);
  const sameCity = city && lines.find((l) => metro(areaCode(l)) === city);
  if (sameCity) return sameCity;
  const prov = AREA_PROVINCE[area];
  return (prov && lines.find((l) => AREA_PROVINCE[areaCode(l)] === prov)) || fallback;
}

/** Replace {{first_name}}-style merge tags. `{{first_name|there}}` falls back to "there" when empty. */
export function renderTemplate(tpl: string, vars: Record<string, unknown>) {
  const out = tpl.replace(/\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g, (_, key: string, fallback?: string) => {
    const v = key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), vars);
    return v == null || v === "" ? (fallback ?? "").trim() : String(v);
  });
  // tidy greetings left dangling by an empty name: "Hey ," → "Hey,"
  return out.replace(/ +([,!.?])/g, "$1");
}

export function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function sum<T>(rows: T[], f: (r: T) => number | string | null | undefined) {
  return rows.reduce((a, r) => a + Number(f(r) ?? 0), 0);
}

export function appUrl(path = "") {
  const base = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return base.replace(/\/$/, "") + path;
}
