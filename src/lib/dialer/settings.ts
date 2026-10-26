/** Power dialer settings (stored in app_kv "dialer_settings"). Shared by server and UI. */

export interface DialerSettings {
  callingHours: { enabled: boolean; weekdayStart: string; weekdayEnd: string; weekendStart: string; weekendEnd: string };
  recycle: { enabled: boolean; outcomes: string[]; delayHours: number; maxAttempts: number };
  inbound: { ringTimeoutSec: number; greetingText: string; greetingDropId: string | null };
}

/** Defaults follow the CRTC telemarketing rules: weekdays 9:00–21:30, weekends 10:00–18:00 (lead's local time). */
export const DEFAULT_DIALER_SETTINGS: DialerSettings = {
  callingHours: { enabled: true, weekdayStart: "09:00", weekdayEnd: "21:30", weekendStart: "10:00", weekendEnd: "18:00" },
  recycle: { enabled: true, outcomes: ["no_answer", "voicemail"], delayHours: 24, maxAttempts: 5 },
  inbound: { ringTimeoutSec: 25, greetingText: "Hi, you've reached Ravenshaw A I. We can't get to the phone right now. Please leave your name, number and a short message after the tone, and we'll call you right back.", greetingDropId: null },
};

export function withDefaults(v: Partial<DialerSettings> | null | undefined): DialerSettings {
  const d = DEFAULT_DIALER_SETTINGS;
  return {
    callingHours: { ...d.callingHours, ...(v?.callingHours ?? {}) },
    recycle: { ...d.recycle, ...(v?.recycle ?? {}) },
    inbound: { ...d.inbound, ...(v?.inbound ?? {}) },
  };
}

/** Lead's local time zone from their area code (Canada; anything else is treated as Eastern). */
const TZ: Record<string, string> = {
  ...Object.fromEntries(["604", "778", "236", "672", "250"].map((a) => [a, "America/Vancouver"])),
  ...Object.fromEntries(["403", "780", "587", "825", "368"].map((a) => [a, "America/Edmonton"])),
  ...Object.fromEntries(["306", "639", "474"].map((a) => [a, "America/Regina"])),
  ...Object.fromEntries(["204", "431", "584", "807"].map((a) => [a, "America/Winnipeg"])),
  ...Object.fromEntries(["902", "782", "506", "428"].map((a) => [a, "America/Halifax"])),
  ...Object.fromEntries(["709", "879"].map((a) => [a, "America/St_Johns"])),
};

export function leadTimeZone(phone?: string | null) {
  const area = (phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").slice(0, 3);
  return TZ[area] ?? "America/Toronto";
}

function localParts(tz: string, at: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(f.formatToParts(at).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday as string, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };

/** Is it OK to call this lead right now? Returns their local time either way. */
export function callingWindow(phone: string | null | undefined, s: DialerSettings["callingHours"], at = new Date()) {
  const tz = leadTimeZone(phone);
  const { weekday, minutes } = localParts(tz, at);
  const weekend = weekday === "Sat" || weekday === "Sun";
  const start = toMin(weekend ? s.weekendStart : s.weekdayStart);
  const end = toMin(weekend ? s.weekendEnd : s.weekdayEnd);
  const localTime = at.toLocaleTimeString("en-CA", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const city = tz.split("/")[1].replace("_", " ");
  return { allowed: !s.enabled || (minutes >= start && minutes < end), localTime, city, window: weekend ? `${s.weekendStart}–${s.weekendEnd}` : `${s.weekdayStart}–${s.weekdayEnd}` };
}
