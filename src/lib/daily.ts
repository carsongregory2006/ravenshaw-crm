import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DAILY_TZ = "America/Toronto";
/** Local hours (Montreal time) when an unfinished checklist triggers a text reminder. */
export const REMINDER_HOURS = [17, 20];

/** Today's date (YYYY-MM-DD) in Montreal time — the checklist resets when this changes. */
export function todayLocal(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DAILY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function localHour(at = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: DAILY_TZ, hour: "numeric", hourCycle: "h23" }).format(at));
}

export interface DailyItem { id: string; title: string; position: number; done: boolean; done_at: string | null }

export async function getDaily(db: SupabaseClient, day = todayLocal()) {
  const [{ data: items }, { data: checks }] = await Promise.all([
    db.from("daily_items").select("id, title, position").eq("active", true).order("position").order("created_at"),
    db.from("daily_checks").select("item_id, done_at").eq("day", day),
  ]);
  const done = new Map((checks ?? []).map((c) => [c.item_id as string, c.done_at as string]));
  const list: DailyItem[] = (items ?? []).map((i) => ({ id: i.id, title: i.title, position: i.position, done: done.has(i.id), done_at: done.get(i.id) ?? null }));
  return { day, items: list, done: list.filter((i) => i.done).length, total: list.length };
}

export async function setDailyCheck(db: SupabaseClient, itemId: string, done: boolean, day = todayLocal()) {
  if (done) {
    const { error } = await db.from("daily_checks").upsert({ item_id: itemId, day }, { onConflict: "item_id,day", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from("daily_checks").delete().eq("item_id", itemId).eq("day", day);
    if (error) throw new Error(error.message);
  }
}

/** Day-by-day completion for the last `days` days (oldest first), for the streak view. */
export async function dailyHistory(db: SupabaseClient, days = 14) {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) dates.push(todayLocal(new Date(Date.now() - i * 86400000)));
  const [{ count: total }, { data: checks }] = await Promise.all([
    db.from("daily_items").select("id", { count: "exact", head: true }).eq("active", true),
    db.from("daily_checks").select("day, item_id, daily_items!inner(active)").gte("day", dates[0]).eq("daily_items.active", true),
  ]);
  const per = new Map<string, number>();
  for (const c of checks ?? []) per.set(c.day as string, (per.get(c.day as string) ?? 0) + 1);
  return dates.map((d) => ({ day: d, done: per.get(d) ?? 0, total: total ?? 0 }));
}

// ───────────── Reminder settings (app_kv) ─────────────

export interface DailyReminderSettings { enabled: boolean; email: string | null }

export async function getReminderSettings(db: SupabaseClient): Promise<DailyReminderSettings> {
  const { data } = await db.from("app_kv").select("value").eq("key", "daily_reminders").maybeSingle();
  const v = (data?.value ?? {}) as Partial<DailyReminderSettings>;
  return { enabled: v.enabled ?? true, email: v.email ?? null };
}

/**
 * Called every minute by the CRM tick. At 5 PM and 8 PM Montreal time, if today's checklist isn't
 * finished, email a reminder (once per slot). To: the saved reminder email, else the first admin's profile email.
 */
export async function dailyReminderTick(db: SupabaseClient, send: (to: string, subject: string, text: string) => Promise<unknown>, at = new Date()) {
  const hour = localHour(at);
  if (!REMINDER_HOURS.includes(hour)) return "not reminder time";
  const day = todayLocal(at);
  const key = `daily_reminder:${day}:${hour}`;
  const { data: sent } = await db.from("app_kv").select("key").eq("key", key).maybeSingle();
  if (sent) return "already sent";
  const settings = await getReminderSettings(db);
  if (!settings.enabled) return "disabled";
  const { items, done, total } = await getDaily(db, day);
  if (!total || done >= total) return "complete";
  let to = settings.email;
  if (!to) {
    const { data: admin } = await db.from("profiles").select("email").eq("role", "admin").eq("is_active", true).not("email", "is", null).order("created_at").limit(1).maybeSingle();
    to = admin?.email ?? null;
  }
  if (!to) return "no email";
  // Claim the slot first so a slow send can't double-text.
  const { error } = await db.from("app_kv").insert({ key, value: { at: at.toISOString() } });
  if (error) return "already sent";
  const left = items.filter((i) => !i.done).map((i) => `• ${i.title}`).join("\n");
  const app = process.env.NEXT_PUBLIC_APP_URL ? `\n${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/daily` : "";
  await send(to, `Daily inputs: ${done}/${total} done — ${total - done} left`, `You've done ${done} of ${total} daily inputs today. Still to do:\n\n${left}\n${app}`);
  return `sent ${done}/${total}`;
}
