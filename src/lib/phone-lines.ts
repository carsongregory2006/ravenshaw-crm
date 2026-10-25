import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { listTelnyxNumbers } from "@/lib/integrations/telnyx";
import { toE164 } from "@/lib/utils";

/**
 * Our phone lines: every active number in the Telnyx account (cached briefly), plus the configured default.
 * TELNYX_NUMBERS (comma-separated) is a fallback for when the Telnyx API can't be reached.
 */
let cache: { at: number; numbers: string[] } | null = null;
const TTL = 5 * 60_000;

export async function defaultLine(): Promise<string | null> {
  const { data } = await createAdminClient().from("workspace_settings").select("sms_from_number").eq("id", 1).single();
  return toE164(data?.sms_from_number || process.env.TELNYX_FROM_NUMBER || null);
}

async function accountNumbers(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.numbers;
  try {
    if (process.env.TELNYX_API_KEY) {
      const numbers = (await listTelnyxNumbers()).map((n) => toE164(n)).filter((n): n is string => !!n);
      if (numbers.length) { cache = { at: Date.now(), numbers }; return numbers; }
    }
  } catch (e) {
    console.error("telnyx number list failed", e);
    if (cache) return cache.numbers;
  }
  return (process.env.TELNYX_NUMBERS ?? "").split(",").map((n) => toE164(n.trim())).filter((n): n is string => !!n);
}

/** All our lines, default first. */
export async function ourLines(): Promise<{ lines: string[]; defaultLine: string | null }> {
  const [def, numbers] = await Promise.all([defaultLine(), accountNumbers()]);
  const rest = [...new Set(numbers)].filter((n) => n !== def).sort();
  return { lines: def ? [def, ...rest] : rest, defaultLine: def ?? rest[0] ?? null };
}

/** The line we last talked to this contact on (texts or calls, either direction), if it's still ours. */
export async function lastUsedLine(contactId: string, lines: string[]): Promise<string | null> {
  const db = createAdminClient();
  const [{ data: msg }, { data: call }] = await Promise.all([
    db.from("messages").select("direction, from_addr, to_addr, created_at").eq("contact_id", contactId).eq("channel", "sms")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("calls").select("direction, from_number, to_number, started_at").eq("contact_id", contactId)
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const candidates = [
    msg && { at: msg.created_at as string, line: msg.direction === "inbound" ? msg.to_addr : msg.from_addr },
    call && { at: call.started_at as string, line: call.direction === "inbound" ? call.to_number : call.from_number },
  ].filter((c): c is { at: string; line: string | null } => !!c).sort((a, b) => b.at.localeCompare(a.at));
  for (const c of candidates) {
    const n = toE164(c.line);
    if (n && lines.includes(n)) return n;
  }
  return null;
}

/**
 * Which of our numbers to send/call from: an explicit pick (if it's ours), else the line the contact
 * last used, else the default line.
 */
export async function resolveLine(opts: { requested?: string | null; contactId?: string | null }): Promise<string | null> {
  const { lines, defaultLine: def } = await ourLines();
  const req = toE164(opts.requested ?? null);
  if (req) {
    if (lines.length && !lines.includes(req)) throw new Error(`${req} isn't one of your Telnyx numbers`);
    return req;
  }
  if (opts.contactId) {
    const last = await lastUsedLine(opts.contactId, lines);
    if (last) return last;
  }
  return def;
}
