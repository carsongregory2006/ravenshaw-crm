"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, Pause, Play, Grid3x3, Delete, PhoneIncoming, Loader2, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import type { Call as TelnyxCall, TelnyxRTC } from "@telnyx/webrtc";
import { Button } from "@/components/ui/button";
import { Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { cn, fmtPhone, lineLabel, toE164 } from "@/lib/utils";
import { DISPOSITIONS, dispositionLabel } from "@/lib/dispositions";
import { incomingLineAction, logCallStartAction, lookupContactByPhoneAction, phoneLinesAction, updateCallAction } from "@/lib/actions/comms";
import { fmtDuration } from "./calls";

export interface DialTarget { phone: string; contactId?: string | null; name?: string }

type ClientStatus = "offline" | "connecting" | "ready" | "error" | "unavailable";
type Phase = "idle" | "incoming" | "connecting" | "ringing" | "active" | "held" | "wrapup";

interface Meta {
  dbId: string | null;
  contactId: string | null;
  name: string | null;
  phone: string;
  direction: "inbound" | "outbound";
  answeredAt: number | null;
  /** Our number: the line we're calling from, or the line an inbound call rang on. */
  line: string | null;
  disposition: string | null;
}
interface Wrapup { dbId: string; contactId: string | null; name: string | null; phone: string; durationSec: number; status: string; disposition: string | null }

interface Phone {
  call: (t: DialTarget) => void;
  open: () => void;
  status: ClientStatus;
  online: boolean;
  toggleOnline: (v: boolean) => void;
  phase: Phase;
  meta: Meta | null;
  wrapup: Wrapup | null;
  now: number;
  muted: boolean;
  showKeys: boolean;
  setShowKeys: (v: boolean) => void;
  number: string;
  setNumber: (fn: (n: string) => string) => void;
  lines: string[];
  defaultLine: string | null;
  pickedLine: string | null;
  pickLine: (l: string | null) => void;
  answer: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  press: (k: string) => void;
  setOutcome: (disposition: string) => Promise<void>;
  finishWrapup: (disposition: string | null, notes: string) => Promise<void>;
}

const Ctx = createContext<Phone | null>(null);
/** Start a call / open the phone from anywhere. */
export const useDialer = () => {
  const p = useContext(Ctx);
  return { call: p?.call ?? (() => {}), open: p?.open ?? (() => {}) };
};
/** Full phone state, for the /phone page. */
export const usePhone = () => useContext(Ctx)!;

const ONLINE_KEY = "dialer-online";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const SUB: Record<string, string> = { "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL", "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ", "0": "+" };

export function DialerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const clientRef = useRef<TelnyxRTC | null>(null);
  const readyPromise = useRef<Promise<TelnyxRTC> | null>(null);
  const callRef = useRef<TelnyxCall | null>(null);
  const metaRef = useRef<Meta | null>(null);
  const finalized = useRef<Set<string>>(new Set());

  const [status, setStatus] = useState<ClientStatus>("offline");
  const [online, setOnline] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [number, setNumber] = useState("");
  const [muted, setMuted] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [wrapup, setWrapup] = useState<Wrapup | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [defaultLine, setDefaultLine] = useState<string | null>(null);
  // null = automatic: the line the contact last used, else the default line.
  const [pickedLine, setPickedLine] = useState<string | null>(null);
  const pickedRef = useRef<string | null>(null);
  const pickLine = (l: string | null) => { pickedRef.current = l; setPickedLine(l); };

  const updateMeta = (m: Meta | null) => { metaRef.current = m; setMeta(m); };

  // call timer
  useEffect(() => {
    if (phase !== "active" && phase !== "held") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Our lines for the "From" picker.
  useEffect(() => {
    phoneLinesAction().then((r) => { if (r.ok) { setLines(r.data.lines); setDefaultLine(r.data.defaultLine); } });
  }, []);

  const finalize = useCallback(async (call: TelnyxCall) => {
    if (finalized.current.has(call.id)) return;
    finalized.current.add(call.id);
    const m = metaRef.current;
    callRef.current = null;
    setMuted(false);
    setShowKeys(false);
    if (!m) { setPhase("idle"); return; }
    const durationSec = m.answeredAt ? Math.round((Date.now() - m.answeredAt) / 1000) : 0;
    const st = m.answeredAt ? "completed" : m.direction === "inbound" ? "missed" : "no_answer";
    const telnyxCallId = call.options?.telnyxSessionId || call.options?.telnyxCallControlId || null;
    if (m.dbId) await updateCallAction(m.dbId, { status: st, durationSec, ended: true, telnyxCallId });
    updateMeta(null);
    // Only ask for an outcome on calls we actually placed or picked up.
    if (m.dbId) {
      setWrapup({ dbId: m.dbId, contactId: m.contactId, name: m.name, phone: m.phone, durationSec, status: st, disposition: m.disposition });
      setPhase("wrapup");
    } else {
      setPhase("idle");
    }
  }, []);

  const onCallUpdate = useCallback(async (call: TelnyxCall) => {
    const state = call.state;
    const isCurrent = callRef.current?.id === call.id;

    if (call.direction === "inbound" && state === "ringing" && !callRef.current) {
      callRef.current = call;
      const phone = call.options?.remoteCallerNumber || "";
      updateMeta({ dbId: null, contactId: null, name: call.options?.remoteCallerName || null, phone, direction: "inbound", answeredAt: null, line: null, disposition: null });
      setPhase("incoming");
      const [r, ln] = await Promise.all([lookupContactByPhoneAction(phone), incomingLineAction(phone)]);
      let line = ln.ok ? ln.data : null;
      if (metaRef.current?.phone === phone) updateMeta({ ...metaRef.current, ...(r.ok && r.data ? { contactId: r.data.id, name: r.data.name } : {}), line });
      toast(`Incoming call from ${r.ok && r.data ? r.data.name : fmtPhone(phone)}${line ? ` on ${lineLabel(line)}` : ""}`);
      if (!line) {
        // The webhook can land a moment after the browser starts ringing.
        await new Promise((res) => setTimeout(res, 2000));
        const again = await incomingLineAction(phone);
        line = again.ok ? again.data : null;
        if (line && metaRef.current?.phone === phone && !metaRef.current.line) updateMeta({ ...metaRef.current, line });
      }
      return;
    }
    if (!isCurrent) {
      // A second inbound call while busy: decline it.
      if (call.direction === "inbound" && state === "ringing") call.hangup().catch(() => {});
      return;
    }
    switch (state) {
      case "trying":
      case "requesting":
        setPhase("connecting");
        break;
      case "ringing":
      case "early":
        setPhase("ringing");
        break;
      case "active": {
        const m = metaRef.current;
        if (m && !m.answeredAt) {
          updateMeta({ ...m, answeredAt: Date.now() });
          if (m.dbId) updateCallAction(m.dbId, { status: "answered", telnyxCallId: call.options?.telnyxSessionId || call.options?.telnyxCallControlId || null });
        }
        setPhase("active");
        break;
      }
      case "held":
        setPhase("held");
        break;
      case "hangup":
      case "destroy":
        await finalize(call);
        break;
    }
  }, [finalize]);

  const ensureClient = useCallback(async (silent = false): Promise<TelnyxRTC> => {
    if (clientRef.current) return clientRef.current;
    if (readyPromise.current) return readyPromise.current;
    setStatus("connecting");
    readyPromise.current = (async () => {
      const res = await fetch("/api/telnyx/token", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(body.notConfigured ? "unavailable" : "error");
        throw new Error(body.error || "Could not get a dialer token");
      }
      setLines(body.lines ?? []);
      setDefaultLine(body.defaultLine ?? null);
      const { TelnyxRTC: Client } = await import("@telnyx/webrtc");
      const client = new Client({ login_token: body.token });
      client.remoteElement = "dialer-remote-audio";
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out connecting to Telnyx")), 15000);
        client.on("telnyx.ready", () => { clearTimeout(timer); resolve(); });
        client.on("telnyx.error", (e: unknown) => { clearTimeout(timer); reject(new Error((e as { error?: { message?: string } })?.error?.message || "Telnyx connection error")); });
        client.on("telnyx.socket.close", () => { setStatus("offline"); clientRef.current = null; readyPromise.current = null; });
        client.on("telnyx.notification", (n: { type: string; call?: TelnyxCall }) => {
          if (n.type === "callUpdate" && n.call) onCallUpdate(n.call);
        });
        client.connect();
      });
      clientRef.current = client;
      setStatus("ready");
      return client;
    })();
    try {
      return await readyPromise.current;
    } catch (e) {
      readyPromise.current = null;
      if (!silent) toast.error(e instanceof Error ? e.message : "Dialer unavailable");
      setStatus((s) => (s === "unavailable" ? s : "error"));
      throw e;
    }
  }, [onCallUpdate]);

  // Restore "online" preference so inbound calls ring in this browser.
  useEffect(() => {
    let pref = false;
    try { pref = localStorage.getItem(ONLINE_KEY) === "1"; } catch {}
    if (pref) { setOnline(true); ensureClient(true).catch(() => {}); }
    return () => { clientRef.current?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleOnline = async (v: boolean) => {
    setOnline(v);
    try { localStorage.setItem(ONLINE_KEY, v ? "1" : "0"); } catch {}
    if (v) {
      try { await ensureClient(); toast.success("You're online — inbound calls will ring here"); } catch { setOnline(false); }
    } else if (!callRef.current) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      readyPromise.current = null;
      setStatus("offline");
    }
  };

  const open = useCallback(() => { if (pathname !== "/phone") router.push("/phone"); }, [pathname, router]);

  const call = useCallback(async (t: DialTarget) => {
    open();
    if (callRef.current) { toast.error("Finish the current call first"); return; }
    const phone = toE164(t.phone);
    if (!phone) { toast.error("Invalid phone number"); return; }
    setWrapup(null);
    updateMeta({ dbId: null, contactId: t.contactId ?? null, name: t.name ?? null, phone, direction: "outbound", answeredAt: null, line: null, disposition: null });
    setPhase("connecting");
    let client: TelnyxRTC;
    try {
      client = await ensureClient();
    } catch {
      setPhase("idle");
      updateMeta(null);
      return;
    }
    // The server picks the line: an explicit pick, else the line this contact last used, else the default.
    const logged = await logCallStartAction({ contactId: t.contactId, phone, direction: "outbound", ourNumber: pickedRef.current });
    if (!logged.ok) { toast.error(logged.error); setPhase("idle"); updateMeta(null); return; }
    const line = logged.data.ourNumber;
    updateMeta({ ...metaRef.current!, dbId: logged.data.id, contactId: logged.data.contactId, line });
    if (!t.name && logged.data.contactId) {
      lookupContactByPhoneAction(phone).then((r) => { if (r.ok && r.data && metaRef.current) updateMeta({ ...metaRef.current, name: r.data.name }); });
    }
    try {
      const c = client.newCall({ destinationNumber: phone, callerNumber: line ?? undefined, audio: true, video: false });
      callRef.current = c as unknown as TelnyxCall;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Call failed");
      await updateCallAction(logged.data.id, { status: "failed", ended: true });
      setPhase("idle");
      updateMeta(null);
    }
  }, [ensureClient, open]);

  const answer = async () => {
    const c = callRef.current;
    const m = metaRef.current;
    if (!c || !m) return;
    try {
      await c.answer();
      const logged = await logCallStartAction({
        contactId: m.contactId, phone: m.phone, direction: "inbound", ourNumber: m.line,
        telnyxCallId: c.options?.telnyxSessionId || c.options?.telnyxCallControlId || null,
      });
      if (logged.ok) updateMeta({ ...metaRef.current!, dbId: logged.data.id, contactId: logged.data.contactId ?? m.contactId, line: logged.data.ourNumber ?? metaRef.current!.line });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not answer");
    }
  };
  const hangup = () => { callRef.current?.hangup().catch(() => {}); };
  const toggleMute = () => {
    const c = callRef.current;
    if (!c) return;
    if (muted) c.unmuteAudio(); else c.muteAudio();
    setMuted(!muted);
  };
  const toggleHold = async () => {
    const c = callRef.current;
    if (!c) return;
    try {
      if (phase === "held") { await c.unhold(); setPhase("active"); } else { await c.hold(); setPhase("held"); }
    } catch { toast.error("Hold failed"); }
  };
  const press = (k: string) => {
    if (callRef.current && (phase === "active" || phase === "held")) callRef.current.dtmf(k);
    else setNumber((n) => n + k);
  };

  /** One-click outcome while the call is live: saved on the call right away. */
  const setOutcome = async (disposition: string) => {
    const m = metaRef.current;
    if (!m?.dbId) { toast.error("The call isn't logged yet — try again in a second"); return; }
    updateMeta({ ...m, disposition });
    const r = await updateCallAction(m.dbId, { disposition });
    if (!r.ok) toast.error(r.error);
    else toast.success(`Outcome: ${dispositionLabel(disposition)}`);
  };

  /** After the call: save the outcome (and any notes) and go back to the dial pad. */
  const finishWrapup = async (disposition: string | null, notes: string) => {
    const w = wrapup;
    if (w && (disposition !== w.disposition || notes.trim())) {
      const r = await updateCallAction(w.dbId, { ...(disposition !== w.disposition ? { disposition } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(disposition ? `Logged: ${dispositionLabel(disposition)}` : "Call logged");
    }
    setWrapup(null);
    setPhase("idle");
  };

  const value: Phone = {
    call, open, status, online, toggleOnline, phase, meta, wrapup, now, muted, showKeys, setShowKeys, number, setNumber,
    lines, defaultLine, pickedLine, pickLine, answer, hangup, toggleMute, toggleHold, press, setOutcome, finishWrapup,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio id="dialer-remote-audio" autoPlay playsInline className="hidden" />
      {/* Off the Phone page, a small card keeps a ringing or live call (and its outcome) within reach. */}
      {pathname !== "/phone" && phase !== "idle" && (
        <div className="fixed bottom-5 right-5 z-40 w-[300px] overflow-hidden rounded-xl border border-border bg-bg shadow-lg">
          <div className="flex h-9 items-center border-b border-border-light px-3 text-xs text-fg-2">
            Phone
            <Link href="/phone" className="ml-auto flex items-center gap-1 text-accent hover:underline"><Maximize2 className="size-3" /> Open</Link>
          </div>
          <CallStage />
        </div>
      )}
    </Ctx.Provider>
  );
}

export function StatusLine() {
  const p = usePhone();
  const dot = { ready: "bg-success", connecting: "bg-warning", offline: "bg-fg-4", error: "bg-danger", unavailable: "bg-fg-4" }[p.status];
  const label = { ready: "Online", connecting: "Connecting…", offline: "Offline", error: "Connection error", unavailable: "Telnyx voice not configured" }[p.status];
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-2 rounded-full", dot)} />
      <span className="text-xs text-fg-2">{label}</span>
      <span className="ml-3 text-xs text-fg-3">Receive calls</span>
      <Switch checked={p.online} onChange={p.toggleOnline} disabled={p.status === "unavailable"} />
    </div>
  );
}

/** Ringing / live call / wrap-up, or the dial pad when idle. */
export function CallStage({ large }: { large?: boolean }) {
  const p = usePhone();
  const { phase, meta } = p;
  const inCall = phase === "connecting" || phase === "ringing" || phase === "active" || phase === "held";

  if (phase === "incoming" && meta) {
    return (
      <div className="p-4 text-center">
        <PhoneIncoming className="mx-auto mb-2 size-6 animate-pulse text-success" />
        <div className="text-sm font-semibold">{meta.name || fmtPhone(meta.phone)}</div>
        {meta.name && <div className="text-xs text-fg-3">{fmtPhone(meta.phone)}</div>}
        {meta.line && <div className="mt-1 text-xs text-fg-2">Calling your {lineLabel(meta.line)} line</div>}
        <div className="mt-4 flex justify-center gap-3">
          <button onClick={p.hangup} className="flex size-12 items-center justify-center rounded-full bg-danger text-white cursor-pointer" aria-label="Decline"><PhoneOff className="size-5" /></button>
          <button onClick={p.answer} className="flex size-12 items-center justify-center rounded-full bg-success text-white cursor-pointer" aria-label="Answer"><Phone className="size-5" /></button>
        </div>
      </div>
    );
  }

  if (inCall && meta) {
    const elapsed = fmtDuration(Math.round((p.now - (meta.answeredAt ?? p.now)) / 1000));
    return (
      <div className="p-4">
        <div className="flex flex-col items-center text-center">
          <Avatar name={meta.name || meta.phone} size={large ? 56 : 40} />
          <div className={cn("mt-2 font-semibold", large ? "text-base" : "text-sm")}>{meta.name || fmtPhone(meta.phone)}</div>
          {meta.name && <div className="text-xs text-fg-3">{fmtPhone(meta.phone)}</div>}
          <div className="mt-1 flex items-center gap-1 text-xs text-fg-2">
            {(phase === "connecting" || phase === "ringing") && <Loader2 className="size-3 animate-spin" />}
            {phase === "connecting" ? "Connecting…" : phase === "ringing" ? "Ringing…" : phase === "held" ? `On hold · ${elapsed}` : elapsed}
          </div>
          {meta.line && <div className="mt-0.5 text-[11px] text-fg-3">{meta.direction === "outbound" ? "From" : "On"} {lineLabel(meta.line)}</div>}
          {meta.contactId && <Link href={`/contacts/${meta.contactId}`} className="mt-1 text-xs text-accent hover:underline">Open profile</Link>}
        </div>
        {p.showKeys && <Keypad onPress={p.press} className="mt-3" />}
        <div className="mt-4 flex justify-center gap-2">
          <RoundBtn onClick={p.toggleMute} active={p.muted} disabled={phase !== "active" && phase !== "held"} label={p.muted ? "Unmute" : "Mute"}>{p.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}</RoundBtn>
          <RoundBtn onClick={p.toggleHold} active={phase === "held"} disabled={phase !== "active" && phase !== "held"} label={phase === "held" ? "Resume" : "Hold"}>{phase === "held" ? <Play className="size-4" /> : <Pause className="size-4" />}</RoundBtn>
          <RoundBtn onClick={() => p.setShowKeys(!p.showKeys)} active={p.showKeys} label="Keypad"><Grid3x3 className="size-4" /></RoundBtn>
          <button onClick={p.hangup} className="flex size-10 items-center justify-center rounded-full bg-danger text-white cursor-pointer" aria-label="Hang up"><PhoneOff className="size-4" /></button>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 text-xs text-fg-3">Outcome</div>
          <OutcomeButtons value={meta.disposition} onPick={p.setOutcome} disabled={!meta.dbId} />
        </div>
      </div>
    );
  }

  if (phase === "wrapup" && p.wrapup) return <WrapupForm key={p.wrapup.dbId} />;
  return large ? <DialPad /> : null;
}

export function OutcomeButtons({ value, onPick, disabled }: { value: string | null; onPick: (d: string) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {DISPOSITIONS.map((d) => (
        <button key={d.value} onClick={() => onPick(d.value)} disabled={disabled}
          className={cn("h-8 rounded-md border px-2 text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
            value === d.value
              ? d.value === "bad_number" ? "border-danger bg-danger text-white" : "border-fg bg-fg text-bg"
              : "border-border bg-bg-2 text-fg hover:bg-hover")}>
          {d.label}
        </button>
      ))}
    </div>
  );
}

function DialPad() {
  const p = usePhone();
  return (
    <div className="p-3">
      <div className="flex items-center gap-1">
        <Input value={p.number} onChange={(e) => p.setNumber(() => e.target.value)} placeholder="Enter a number"
          onKeyDown={(e) => e.key === "Enter" && p.number && p.call({ phone: p.number })} className="h-10 text-center text-base tracking-wide" />
        <Button size="md" variant="ghost" icon={Delete} onClick={() => p.setNumber((n) => n.slice(0, -1))} aria-label="Backspace" />
      </div>
      <Keypad onPress={p.press} className="mt-2" />
      {p.lines.length > 1 && (
        <Select value={p.pickedLine ?? ""} onChange={(e) => p.pickLine(e.target.value || null)} className="mt-2 h-8 text-xs" aria-label="Call from">
          <option value="">From: auto (contact&apos;s last line, else {lineLabel(p.defaultLine)})</option>
          {p.lines.map((l) => <option key={l} value={l}>From: {lineLabel(l)}{l === p.defaultLine ? " (default)" : ""}</option>)}
        </Select>
      )}
      <Button variant="primary" size="md" icon={Phone} className="mt-3 w-full bg-success hover:bg-success hover:opacity-90" disabled={!p.number || p.status === "unavailable"} onClick={() => p.call({ phone: p.number })}>
        Call
      </Button>
      {p.status === "unavailable" && <p className="mt-2 text-center text-xs text-fg-3">Add TELNYX_API_KEY and TELNYX_CONNECTION_ID to enable calling.</p>}
    </div>
  );
}

function RoundBtn({ children, onClick, active, disabled, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; label: string }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={cn("flex size-10 items-center justify-center rounded-full border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
        active ? "border-fg bg-fg text-bg" : "border-border bg-bg-2 text-fg hover:bg-hover")}>
      {children}
    </button>
  );
}

function Keypad({ onPress, className }: { onPress: (k: string) => void; className?: string }) {
  return (
    <div className={cn("grid grid-cols-3 gap-1.5", className)}>
      {KEYS.map((k) => (
        <button key={k} onClick={() => onPress(k)} className="flex h-11 flex-col items-center justify-center rounded-lg bg-bg-2 hover:bg-active cursor-pointer">
          <span className="text-base font-medium leading-none">{k}</span>
          {SUB[k] && <span className="mt-0.5 text-[9px] tracking-widest text-fg-4">{SUB[k]}</span>}
        </button>
      ))}
    </div>
  );
}

function WrapupForm() {
  const p = usePhone();
  const w = p.wrapup!;
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const pick = async (d: string | null) => {
    setSaving(d ?? "done");
    await p.finishWrapup(d, notes);
    setSaving(null);
  };
  return (
    <div className="space-y-2 p-3">
      <div className="text-[13px] font-medium">Call ended · {fmtDuration(w.durationSec)}</div>
      <div className="text-xs text-fg-3">
        {w.name || fmtPhone(w.phone)}
        {w.contactId && <> · <Link href={`/contacts/${w.contactId}`} className="text-accent hover:underline">Open profile</Link></>}
      </div>
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)…" className="min-h-16" />
      <div className="text-xs text-fg-3">Pick an outcome to log it</div>
      <OutcomeButtons value={w.disposition} onPick={pick} disabled={!!saving} />
      <div className="flex justify-end">
        <Button size="sm" loading={saving === "done"} onClick={() => pick(w.disposition)}>{w.disposition ? `Done (${dispositionLabel(w.disposition)})` : "Skip"}</Button>
      </div>
    </div>
  );
}
