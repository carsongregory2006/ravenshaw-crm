import "server-only";
import { unstable_rethrow } from "next/navigation";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Wrap server-action bodies so client code always gets { ok, data | error } instead of a thrown error. */
export async function safe<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e); // let redirect()/notFound() propagate
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
