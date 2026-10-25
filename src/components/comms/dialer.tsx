"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, Pause, Play, Grid3x3, X, Delete, PhoneIncoming, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Call as TelnyxCall, TelnyxRTC } from "@telnyx/webrtc";
import { Button } from "@/components/ui/button";
import { Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { cn, fmtPhone, lineLabel, toE164 } from "@/lib/utils";
import { incomingLineAction, logCallStartAction, lookupContactByPhoneAction, phoneLinesAction, updateCallAction } from "@/lib/actions/comms";
import { DISPOSITIONS, fmtDuration } from "./calls";

export interface DialTarget { phone: string; contactId?: string | null; name?: string }

interface DialerApi {
  call: (t: DialTarget) => void;
  open: () => void;
}
const Ctx = createContext<DialerApi>({ call: () => {}, open: () => {} });
export const useDialer = () => useContext(Ctx);

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
}
interface Wrapup { dbId: string | null; contactId: string | null; name: string | null; phone: string; durationSec: number; status: string }

const ONLINE_KEY = "dialer-online";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const SUB: Record<string, string> = { "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL", "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ", "0": "+" };

export function DialerProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<TelnyxRTC | null>(null);
  const readyPromise = useRef<Promise<TelnyxRTC> | null>(null);
  const callRef = useRef<TelnyxCall | null>(null);
  const metaRef = useRef<Meta | null>(null);
  const finalized = useRef<Set<string>>(new Set());

  const [status, setStatus] = useState<ClientStatus>("offline");
  const [online, setOnline] = useState(false);
  const [panel, setPanel] = useState(false);
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
      setWrapup({ dbId: m.dbId, contactId: m.contactId, name: m.name, phone: m.phone, durationSec, status: st });
      setPhase("wrapup");
      setPanel(true);
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
      updateMeta({ dbId: null, contactId: null, name: call.options?.remoteCallerName || null, phone, direction: "inbound", answeredAt: null, line: null });
      setPhase("incoming");
      setPanel(true);
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

  // Load our lines for the "From" picker the first time the pad opens (the token fetch also refreshes them).
  useEffect(() => {
    if (!panel || lines.length) return;
    phoneLinesAction().then((r) => { if (r.ok) { setLines(r.data.lines); setDefaultLine(r.data.defaultLine); } });
  }, [panel, lines.length]);

  // Esc closes the dial pad when no call is in progress.
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !callRef.current && !wrapup) setPanel(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, wrapup]);

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

  const call = useCallback(async (t: DialTarget) => {
    setPanel(true);
    if (callRef.current) { toast.error("Finish the current call first"); return; }
    const phone = toE164(t.phone);
    if (!phone) { toast.error("Invalid phone number"); return; }
    setWrapup(null);
    updateMeta({ dbId: null, contactId: t.contactId ?? null, name: t.name ?? null, phone, direction: "outbound", answeredAt: null, line: null });
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
  }, [ensureClient]);

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

  const inCall = phase === "connecting" || phase === "ringing" || phase === "active" || phase === "held";
  const statusDot = { ready: "bg-success", connecting: "bg-warning", offline: "bg-fg-4", error: "bg-danger", unavailable: "bg-fg-4" }[status];
  const label = { ready: "Online", connecting: "Connecting…", offline: "Offline", error: "Connection error", unavailable: "Telnyx voice not configured" }[status];

  return (
    <Ctx.Provider value={{ call, open: () => setPanel(true) }}>
      {children}
      <audio id="dialer-remote-audio" autoPlay playsInline className="hidden" />

      {/* Idle: opened from the sidebar "Phone" item. Floats only while ringing or on a call. */}
      {!panel && (inCall || phase === "incoming") && (
        <button
          onClick={() => setPanel(true)}
          className={cn("fixed bottom-5 right-5 z-40 flex size-11 items-center justify-center rounded-full shadow-lg cursor-pointer transition-colors",
            inCall ? "bg-success text-white animate-pulse" : phase === "incoming" ? "bg-success text-white animate-bounce" : "bg-fg text-bg hover:opacity-90")}
          aria-label="Open dialer"
        >
          <Phone className="size-5" />
        </button>
      )}

      {panel && (
        <div className="fixed bottom-5 right-5 z-40 w-[300px] overflow-hidden rounded-xl border border-border bg-bg shadow-lg">
          <div className="flex h-10 items-center gap-2 border-b border-border-light px-3">
            <span className={cn("size-2 rounded-full", statusDot)} />
            <span className="text-xs text-fg-2">{label}</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-fg-3">Receive calls</span>
              <Switch checked={online} onChange={toggleOnline} disabled={status === "unavailable"} />
              <button onClick={() => setPanel(false)} className="rounded-sm p-0.5 text-fg-3 hover:bg-hover cursor-pointer" aria-label="Minimize dialer"><X className="size-4" /></button>
            </div>
          </div>

          {phase === "incoming" && meta && (
            <div className="p-4 text-center">
              <PhoneIncoming className="mx-auto mb-2 size-6 animate-pulse text-success" />
              <div className="text-sm font-semibold">{meta.name || fmtPhone(meta.phone)}</div>
              {meta.name && <div className="text-xs text-fg-3">{fmtPhone(meta.phone)}</div>}
              {meta.line && <div className="mt-1 text-xs text-fg-2">Calling your {lineLabel(meta.line)} line</div>}
              <div className="mt-4 flex justify-center gap-3">
                <button onClick={hangup} className="flex size-12 items-center justify-center rounded-full bg-danger text-white cursor-pointer" aria-label="Decline"><PhoneOff className="size-5" /></button>
                <button onClick={answer} className="flex size-12 items-center justify-center rounded-full bg-success text-white cursor-pointer" aria-label="Answer"><Phone className="size-5" /></button>
              </div>
            </div>
          )}

          {inCall && meta && (
            <div className="p-4">
              <div className="flex flex-col items-center text-center">
                <Avatar name={meta.name || meta.phone} size={40} />
                <div className="mt-2 text-sm font-semibold">{meta.name || fmtPhone(meta.phone)}</div>
                {meta.name && <div className="text-xs text-fg-3">{fmtPhone(meta.phone)}</div>}
                <div className="mt-1 flex items-center gap-1 text-xs text-fg-2">
                  {(phase === "connecting" || phase === "ringing") && <Loader2 className="size-3 animate-spin" />}
                  {phase === "connecting" ? "Connecting…" : phase === "ringing" ? "Ringing…" : phase === "held" ? `On hold · ${fmtDuration(Math.round((now - (meta.answeredAt ?? now)) / 1000))}` : fmtDuration(Math.round((now - (meta.answeredAt ?? now)) / 1000))}
                </div>
                {meta.line && <div className="mt-0.5 text-[11px] text-fg-3">{meta.direction === "outbound" ? "From" : "On"} {lineLabel(meta.line)}</div>}
                {meta.contactId && <Link href={`/contacts/${meta.contactId}`} className="mt-1 text-xs text-accent hover:underline">Open profile</Link>}
              </div>
              {showKeys && <Keypad onPress={press} className="mt-3" />}
              <div className="mt-4 flex justify-center gap-2">
                <RoundBtn onClick={toggleMute} active={muted} disabled={phase !== "active" && phase !== "held"} label={muted ? "Unmute" : "Mute"}>{muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}</RoundBtn>
                <RoundBtn onClick={toggleHold} active={phase === "held"} disabled={phase !== "active" && phase !== "held"} label={phase === "held" ? "Resume" : "Hold"}>{phase === "held" ? <Play className="size-4" /> : <Pause className="size-4" />}</RoundBtn>
                <RoundBtn onClick={() => setShowKeys(!showKeys)} active={showKeys} label="Keypad"><Grid3x3 className="size-4" /></RoundBtn>
                <button onClick={hangup} className="flex size-10 items-center justify-center rounded-full bg-danger text-white cursor-pointer" aria-label="Hang up"><PhoneOff className="size-4" /></button>
              </div>
            </div>
          )}

          {phase === "wrapup" && wrapup && <WrapupForm wrapup={wrapup} onDone={() => { setWrapup(null); setPhase("idle"); }} />}

          {phase === "idle" && (
            <div className="p-3">
              <div className="flex items-center gap-1">
                <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Enter a number"
                  onKeyDown={(e) => e.key === "Enter" && number && call({ phone: number })} className="h-9 text-center text-base tracking-wide" />
                <Button size="md" variant="ghost" icon={Delete} onClick={() => setNumber((n) => n.slice(0, -1))} aria-label="Backspace" />
              </div>
              <Keypad onPress={press} className="mt-2" />
              {lines.length > 1 && (
                <Select value={pickedLine ?? ""} onChange={(e) => pickLine(e.target.value || null)} className="mt-2 h-8 text-xs" aria-label="Call from">
                  <option value="">From: auto (contact&apos;s last line, else {lineLabel(defaultLine)})</option>
                  {lines.map((l) => <option key={l} value={l}>From: {lineLabel(l)}{l === defaultLine ? " (default)" : ""}</option>)}
                </Select>
              )}
              <Button variant="primary" size="md" icon={Phone} className="mt-3 w-full bg-success hover:bg-success hover:opacity-90" disabled={!number || status === "unavailable"} onClick={() => call({ phone: number })}>
                Call
              </Button>
              {status === "unavailable" && <p className="mt-2 text-center text-xs text-fg-3">Add TELNYX_API_KEY and TELNYX_CONNECTION_ID to enable calling.</p>}
            </div>
          )}
        </div>
      )}
    </Ctx.Provider>
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

function WrapupForm({ wrapup, onDone }: { wrapup: Wrapup; onDone: () => void }) {
  const [disposition, setDisposition] = useState(wrapup.status === "completed" ? "connected" : "no_answer");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!wrapup.dbId) return onDone();
    setSaving(true);
    const r = await updateCallAction(wrapup.dbId, { disposition, notes: notes || null });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Call logged");
    onDone();
  };
  return (
    <div className="space-y-2 p-3">
      <div className="text-[13px] font-medium">Call ended · {fmtDuration(wrapup.durationSec)}</div>
      <div className="text-xs text-fg-3">
        {wrapup.name || fmtPhone(wrapup.phone)}
        {wrapup.contactId && <> · <Link href={`/contacts/${wrapup.contactId}`} className="text-accent hover:underline">Open profile</Link></>}
      </div>
      <Select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
        {DISPOSITIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
      </Select>
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Call notes…" className="min-h-20" autoFocus />
      <div className="flex justify-end gap-1.5">
        <Button onClick={onDone}>Skip</Button>
        <Button variant="primary" loading={saving} onClick={save}>Save outcome</Button>
      </div>
    </div>
  );
}
