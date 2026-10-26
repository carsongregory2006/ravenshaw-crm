import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FolderKey } from "@/lib/types";

/** Where a call outcome files the contact. */
const OUTCOME_FOLDER: Record<string, FolderKey> = {
  no_answer: "attempted", voicemail: "attempted",
  bad_number: "bad_dnc", wrong_number: "bad_dnc",
  not_interested: "not_interested",
  callback: "callback",
  interested: "interested", booked: "interested",
  connected: "contacted",
};
// "Attempted" never pulls someone back out of a later stage.
const ATTEMPT_FROM: (FolderKey | null)[] = [null, "new", "attempted"];

let cache: Map<string, string> | null = null;
async function folderIds() {
  if (cache) return cache;
  const { data } = await createAdminClient().from("contact_folders").select("id, system_key").not("system_key", "is", null);
  cache = new Map((data ?? []).map((f) => [f.system_key as string, f.id as string]));
  return cache;
}

/**
 * Move a contact into a system folder. Contacts you've put in a custom folder stay put, and
 * Attempted/Contacted don't override later stages (Call Back, Interested, ...).
 */
export async function fileContact(contactId: string, key: FolderKey) {
  const db = createAdminClient();
  const ids = await folderIds();
  const target = ids.get(key);
  if (!target) return;
  const { data: c } = await db.from("contacts").select("folder_id").eq("id", contactId).maybeSingle();
  if (!c) return;
  const currentKey = c.folder_id ? ([...ids.entries()].find(([, id]) => id === c.folder_id)?.[0] as FolderKey | undefined) : null;
  if (c.folder_id && currentKey === undefined) return; // custom folder
  if (c.folder_id === target) return;
  if (key === "attempted" && !ATTEMPT_FROM.includes(currentKey ?? null)) return;
  if (key === "contacted" && !([null, "new", "attempted"] as (FolderKey | null)[]).includes(currentKey ?? null)) return;
  await db.from("contacts").update({ folder_id: target, folder_updated_at: new Date().toISOString() }).eq("id", contactId);
}

export async function fileContactForOutcome(contactId: string, disposition: string) {
  const key = OUTCOME_FOLDER[disposition];
  if (key) await fileContact(contactId, key);
}
