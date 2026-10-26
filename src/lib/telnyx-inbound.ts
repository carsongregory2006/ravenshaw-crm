import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { browserSipUri, callAction, decodeState, dialCall, encodeState } from "@/lib/integrations/telnyx";
import { getDialerSettings } from "@/lib/dialer-settings";
import { logActivity, notify, notifyAdmins } from "@/lib/activity";
import { contactLabel, fmtPhone, lineLabel } from "@/lib/utils";

/**
 * Inbound calls through the CRM's Call Control application:
 *   caller (A) → we answer + play ringback → dial the browser dialer (B, linked to A's session)
 *   B answers → bridge A↔B.   B never answers / nobody online → greeting → record voicemail on A.
 * A's call row is logged by the generic webhook code (one row per session); B is never logged.
 */

const APP_KV = "telnyx_inbound_app";
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function inboundAppId(): Promise<string | null> {
  const { data } = await createAdminClient().from("app_kv").select("value").eq("key", APP_KV).maybeSingle();
  return (data?.value as { id?: string } | null)?.id ?? null;
}
export async function saveInboundAppId(id: string) {
  await createAdminClient().from("app_kv").upsert({ key: APP_KV, value: { id }, updated_at: new Date().toISOString() });
}

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
const ringbackUrl = () => `${appUrl()}/api/public/ringback`;
const quiet = (p: Promise<unknown>) => p.catch((e) => console.error("telnyx inbound", e instanceof Error ? e.message : e));

/** Returns true when the event belongs to inbound routing and the generic logger should skip it. */
export async function handleInboundRouting(type: string, p: any): Promise<boolean> {
  const state = decodeState(p.client_state);

  // B leg (the browser being rung): drive the bridge / voicemail, never log it as its own call.
  if (state?.k === "agent") {
    await onAgentLeg(type, p, state.a);
    return true;
  }

  const appId = await inboundAppId();
  const isCaller = state?.k === "caller" || (!!appId && p.connection_id === appId && p.direction === "incoming");
  if (!isCaller) return false;

  switch (type) {
    case "call.initiated":
      await quiet(callAction(p.call_control_id, "answer", { client_state: encodeState({ k: "caller" }) }));
      return false; // let the generic code create the call row
    case "call.answered":
      await ringBrowser(p);
      return true; // we answered it ourselves: not a real "answered"
    case "call.speak.ended":
      if (state?.s === "greet") await startRecording(p.call_control_id);
      return true;
    case "call.playback.ended":
      if (state?.s === "greet" && !String(p.media_url ?? "").includes("/api/public/ringback")) await startRecording(p.call_control_id);
      return true;
    case "call.recording.saved":
      await saveVoicemail(p);
      return true;
    case "call.recording.error":
      await quiet(callAction(p.call_control_id, "hangup"));
      return true;
    default:
      return false; // hangup etc. → generic handling (missed-call task, notification)
  }
}

async function ringBrowser(p: any) {
  const a = p.call_control_id as string;
  const { inbound } = await getDialerSettings();
  await quiet(callAction(a, "playback_start", { audio_url: ringbackUrl(), loop: "infinity", client_state: encodeState({ k: "caller", s: "ring" }) }));
  try {
    const to = await browserSipUri();
    const base = {
      connection_id: p.connection_id, to, link_to: a, timeout_secs: Math.min(60, Math.max(10, inbound.ringTimeoutSec)),
      client_state: encodeState({ k: "agent", a }), custom_headers: [{ name: "X-Ravenshaw-Line", value: String(p.to ?? "") }],
    };
    // Show the caller's number in the browser; fall back to our own number if Telnyx refuses it as caller ID.
    try { await dialCall({ ...base, from: p.from }); }
    catch { await dialCall({ ...base, from: p.to }); }
  } catch (e) {
    console.error("ring browser failed", e);
    await startVoicemail(a);
  }
}

async function onAgentLeg(type: string, p: any, a: string) {
  const db = createAdminClient();
  const session = p.call_session_id as string | undefined;
  if (type === "call.answered") {
    await quiet(callAction(a, "playback_stop", { stop: "all" }));
    await quiet(callAction(a, "bridge", { call_control_id: p.call_control_id }));
    if (session) await db.from("calls").update({ status: "answered" }).eq("telnyx_call_id", session);
  } else if (type === "call.hangup") {
    const { data: row } = session ? await db.from("calls").select("status").eq("telnyx_call_id", session).maybeSingle() : { data: null };
    if (row?.status === "answered" || row?.status === "completed") await quiet(callAction(a, "hangup"));
    else await startVoicemail(a);
  }
}

async function startVoicemail(a: string) {
  // Once per caller leg (B hangup and a failed dial can both get here).
  const { error } = await createAdminClient().from("app_kv").insert({ key: `vm:${a}`, value: { at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  if (error) return;
  const { inbound } = await getDialerSettings();
  await quiet(callAction(a, "playback_stop", { stop: "all" }));
  const greet = encodeState({ k: "caller", s: "greet" });
  if (inbound.greetingDropId) {
    const db = createAdminClient();
    const { data: drop } = await db.from("voicemail_drops").select("storage_path").eq("id", inbound.greetingDropId).maybeSingle();
    const signed = drop ? (await db.storage.from("voicemails").createSignedUrl(drop.storage_path, 600)).data?.signedUrl : null;
    if (signed) { await quiet(callAction(a, "playback_start", { audio_url: signed, client_state: greet })); return; }
  }
  await quiet(callAction(a, "speak", { payload: inbound.greetingText, voice: "female", language: "en-US", client_state: greet }));
}

async function startRecording(a: string) {
  await quiet(callAction(a, "record_start", {
    format: "mp3", channels: "single", play_beep: true, max_length: 180, timeout_secs: 8, client_state: encodeState({ k: "caller", s: "rec" }),
  }));
}

async function saveVoicemail(p: any) {
  const db = createAdminClient();
  const url = p.public_recording_urls?.mp3 || p.recording_urls?.mp3;
  const session = p.call_session_id as string | undefined;
  await quiet(callAction(p.call_control_id, "hangup"));
  if (!url || !session) return;
  const secs = p.recording_started_at && p.recording_ended_at
    ? Math.round((new Date(p.recording_ended_at).getTime() - new Date(p.recording_started_at).getTime()) / 1000) : null;
  if (secs != null && secs < 2) return; // hung up at the beep

  const audio = Buffer.from(await (await fetch(url)).arrayBuffer());
  const path = `inbound/${session}.mp3`;
  const { error } = await db.storage.from("voicemails").upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (error) { console.error("voicemail upload", error.message); return; }

  const { data: call } = await db.from("calls").update({ voicemail_path: path, voicemail_duration_sec: secs })
    .eq("telnyx_call_id", session).select("id, contact_id, from_number, to_number").maybeSingle();
  const contact = call?.contact_id ? (await db.from("contacts").select("id, first_name, last_name, email, phone, owner_id").eq("id", call.contact_id).maybeSingle()).data : null;
  const who = contact ? contactLabel(contact) : fmtPhone(call?.from_number ?? p.from);
  const n = { title: `New voicemail from ${who}`, body: `${secs ?? "?"}s${call?.to_number ? ` · on ${lineLabel(call.to_number)}` : ""}`, link: contact ? `/contacts/${contact.id}` : "/phone" };
  if (contact?.owner_id) await notify([contact.owner_id], n); else await notifyAdmins(n);
  if (contact) await logActivity({ type: "call", contact_id: contact.id, title: `Voicemail left (${secs ?? "?"}s)`, metadata: { call_id: call?.id } });
}
