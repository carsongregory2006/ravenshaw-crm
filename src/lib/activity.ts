import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActivityType } from "@/lib/types";

export async function logActivity(a: {
  type: ActivityType;
  title: string;
  body?: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
  company_id?: string | null;
  client_id?: string | null;
  actor_id?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = createAdminClient();
  await db.from("activities").insert({ metadata: {}, ...a });
}

/** In-app notification to one or more users (null/undefined ids are skipped). */
export async function notify(userIds: (string | null | undefined)[], n: { title: string; body?: string; link?: string }) {
  const ids = [...new Set(userIds.filter(Boolean) as string[])];
  if (!ids.length) return;
  const db = createAdminClient();
  await db.from("notifications").insert(ids.map((user_id) => ({ user_id, ...n })));
}

export async function notifyAdmins(n: { title: string; body?: string; link?: string }, alsoUserIds: (string | null | undefined)[] = []) {
  const db = createAdminClient();
  const { data } = await db.from("profiles").select("id").in("role", ["admin"]).eq("is_active", true);
  await notify([...(data ?? []).map((p) => p.id), ...alsoUserIds], n);
}
