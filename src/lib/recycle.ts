import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDialerSettings } from "@/lib/dialer-settings";

/** The rep's "Recycled" lead list (created on first use). */
async function recycledListId(userId: string) {
  const db = createAdminClient();
  const { data } = await db.from("lead_lists").select("id").eq("source", "recycled").eq("created_by", userId).is("archived_at", null).limit(1).maybeSingle();
  if (data) return data.id as string;
  const { data: created, error } = await db.from("lead_lists").insert({ name: "Recycled", source: "recycled", created_by: userId }).select("id").single();
  if (error) throw new Error(error.message);
  return created.id as string;
}

/**
 * No answer / Left voicemail (configurable) puts the lead in the Recycled list, callable again after the delay,
 * up to the max attempts. Any other outcome takes them out of the queue.
 */
export async function recycleForOutcome(contactId: string, disposition: string, userId: string) {
  const s = (await getDialerSettings()).recycle;
  if (!s.enabled) return;
  const db = createAdminClient();
  const listId = await recycledListId(userId);
  const { data: item } = await db.from("lead_list_items").select("id, attempts, status").eq("list_id", listId).eq("contact_id", contactId).maybeSingle();
  const now = new Date();

  if (!s.outcomes.includes(disposition)) {
    if (item?.status === "pending") await db.from("lead_list_items").update({ status: "called", last_outcome: disposition, last_called_at: now.toISOString() }).eq("id", item.id);
    return;
  }
  const attempts = (item?.attempts ?? 0) + 1;
  const exhausted = attempts > s.maxAttempts;
  const patch = {
    status: exhausted ? "called" : "pending", attempts, last_outcome: disposition, last_called_at: now.toISOString(),
    available_at: exhausted ? null : new Date(now.getTime() + s.delayHours * 3_600_000).toISOString(), added_at: now.toISOString(),
  };
  if (item) await db.from("lead_list_items").update(patch).eq("id", item.id);
  else if (!exhausted) await db.from("lead_list_items").insert({ list_id: listId, contact_id: contactId, position: Math.floor(now.getTime() / 1000), ...patch });
}
