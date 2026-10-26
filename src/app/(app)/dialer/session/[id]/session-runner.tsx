"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Ban, Building2, CalendarCheck, CalendarClock, ChevronRight, Loader2, Mic, MicOff, Pause, Phone, PhoneOff, Play, Send, SkipForward, Square, Voicemail, Zap,
} from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Kbd, Spinner } from "@/components/ui/misc";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Time } from "@/components/ui/time";
import { StatusLine, usePhone } from "@/components/comms/dialer";
import { fmtDuration } from "@/components/comms/calls";
import { SessionSummary } from "@/components/dialer/session-summary";
import { HealthMeter } from "@/components/dialer/health";
import { useCallerIdHealth, useFolders } from "../../folders";
import { createClient } from "@/lib/supabase/client";
import { phoneLinesAction, updateCallAction } from "@/lib/actions/comms";
import {
  createCallbackTaskAction, endSessionAction, leadHistoryAction, loadSessionAction, markDncAction, moveToFolderAction, sendTemplateAction,
  setSessionPositionAction, voicemailUrlAction, type SessionLead,
} from "@/lib/actions/dialer";
import { DISPOSITIONS, dispositionLabel } from "@/lib/dispositions";
import { computeStats, fmtSecs, type CallLite, type DialStats } from "@/lib/dialer/stats";
import { cn, fmtPhone, lineLabel, localLine } from "@/lib/utils";
import type { DialSession, Template } from "@/lib/types";
import { callingWindow, DEFAULT_DIALER_SETTINGS, type DialerSettings } from "@/lib/dialer/settings";
import { EditLeadDialog } from "./edit-lead";
import { BookMeetingDialog } from "./book-meeting";

type Stage = "ready" | "dialing" | "wrapup" | "callback" | "countdown" | "done" | "ended";
type History = { health: SessionLead["health"]; folderId: string | null; calls: { id: string; direction: string; started_at: string; duration_sec: number | null; status: string; disposition: string | null; notes: string | null }[]; activities: { id: string; type: string; title: string; body: string | null; created_at: string }[] };

const KEY_OUTCOMES = DISPOSITIONS.map((d) => d.value); // keys 1–6
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

function tomorrowAt10() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:00`;
}

export function SessionRunner({ id }: { id: string }) {
  const p = usePhone();
  const [session, setSession] = useState<DialSession | null>(null);
  const [leads, setLeads] = useState<SessionLead[]>([]);
  const [calls, setCalls] = useState<(CallLite & { id: string; contact_id: string | null })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [vm, setVm] = useState<{ id: string; name: string; url: string | null } | null>(null);
  const [settings, setSettings] = useState<DialerSettings>(DEFAULT_DIALER_SETTINGS);
  const [held, setHeld] = useState(0);
  const [editing, setEditing] = useState(false);
  const [booking, setBooking] = useState(false);

  const [pos, setPos] = useState(0);
  const [stage, setStage] = useState<Stage>("ready");
  const [paused, setPaused] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [lastCallId, setLastCallId] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  const [callbackAt, setCallbackAt] = useState(tomorrowAt10());
  const [history, setHistory] = useState<History | null>(null);
  const { folders, reload: reloadFolders } = useFolders();
  const lineHealth = useCallerIdHealth();
  /** Fresh history, number health and folder for a lead. */
  const refreshLead = useCallback((contactId: string) => leadHistoryAction(contactId).then((r) => {
    if (!r.ok) return;
    setHistory(r.data as History);
    setLeads((ls) => ls.map((x) => (x.id === contactId ? { ...x, health: r.data.health, folderId: r.data.folderId } : x)));
  }), []);
  const [templateId, setTemplateId] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [summary, setSummary] = useState<DialStats | null>(null);
  const [ending, setEnding] = useState(false);
  const [now, setNow] = useState(Date.now());

  const lead = leads[pos] as SessionLead | undefined;
  const fromFor = useCallback((l: SessionLead | undefined) => {
    if (!session || !l) return null;
    return session.from_mode === "local" ? localLine(l.phone, lines, session.from_number) : session.from_number;
  }, [session, lines]);

  // ── Load ──
  useEffect(() => {
    loadSessionAction(id).then(async (r) => {
      if (!r.ok) return setError(r.error);
      const { session: s, leads: ls, calls: cs, voicemail, settings: st } = r.data;
      setSettings(st);
      setSession(s);
      setLeads(ls);
      setCalls(cs);
      setPos(Math.min(s.position, ls.length));
      if (s.ended_at) { setSummary(s.stats); setStage("ended"); }
      else if (s.position >= ls.length) setStage("done");
      if (voicemail) {
        const u = await voicemailUrlAction(voicemail.id);
        setVm({ ...voicemail, url: u.ok ? u.data.url : null });
      }
    });
    phoneLinesAction().then((r) => r.ok && setLines(r.data.lines));
    createClient().from("templates").select("*").order("name").then(({ data }) => setTemplates((data as Template[]) ?? []));
  }, [id]);

  const reloadCalls = useCallback(async () => {
    const { data } = await createClient().from("calls").select("id, contact_id, started_at, duration_sec, status, disposition, from_number").eq("dial_session_id", id).order("started_at");
    setCalls((data as typeof calls) ?? []);
  }, [id]);

  // Lead history for the card.
  useEffect(() => {
    if (!lead) return setHistory(null);
    setHistory(null);
    refreshLead(lead.id);
  }, [lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stage !== "dialing" && session?.ended_at == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage, session?.ended_at]);

  // ── Dialing ──
  const dial = useCallback(async (index: number) => {
    const l = leads[index];
    if (!session || !l) return;
    if (l.doNotContact || l.phoneBad || !l.phone) {
      toast(`Skipped ${l.name}: ${l.doNotContact ? "Do Not Contact" : l.phoneBad ? "bad number" : "no phone"}`);
      const next = index + 1;
      setPos(next);
      await setSessionPositionAction(id, next, l.id);
      if (next >= leads.length) setStage("done"); else dial(next);
      return;
    }
    // Calling hours (lead's local time): hold them — they stay "to call" in the list for a later session.
    const w = callingWindow(l.phone, settings.callingHours);
    if (!w.allowed) {
      toast(`Held ${l.name}: it's ${w.localTime} in ${w.city} (calling hours ${w.window})`);
      setHeld((h) => h + 1);
      const next = index + 1;
      setPos(next);
      await setSessionPositionAction(id, next, null);
      if (next >= leads.length) setStage("done"); else dial(next);
      return;
    }
    setNotes(""); setSavedNotes(""); setLastCallId(null); setLastOutcome(null); setCallbackAt(tomorrowAt10());
    setStage("dialing");
    const ok = await p.call({ phone: l.phone, contactId: l.id, name: l.name }, { from: fromFor(l), dialSessionId: id, stay: true });
    if (!ok) { setStage("ready"); setPaused(true); }
  }, [session, leads, p, fromFor, id, settings.callingHours]);

  const advancing = useRef(false);
  const goTo = useCallback(async (next: number, skipId?: string | null) => {
    if (advancing.current) return;
    advancing.current = true;
    try {
      // Notes typed after the outcome was saved still belong on that call.
      if (lastCallId && notes.trim() && notes !== savedNotes) await updateCallAction(lastCallId, { notes: notes.trim() });
      setPos(next);
      const r = await setSessionPositionAction(id, next, skipId ?? null);
      if (!r.ok) toast.error(r.error);
    } finally {
      advancing.current = false;
    }
    if (next >= leads.length) { setStage("done"); return; }
    if (paused) { setStage("ready"); setNotes(""); return; }
    dial(next);
  }, [lastCallId, notes, savedNotes, id, leads.length, paused, dial]);

  /** Outcome saved (and call over): callback form or countdown to the next lead. */
  const afterOutcome = useCallback((disposition: string) => {
    setLastOutcome(disposition);
    setLeads((ls) => ls.map((x, i) => (i === pos ? { ...x, lastOutcome: disposition, phoneBad: x.phoneBad || disposition === "bad_number" } : x)));
    reloadCalls();
    if (lead) { refreshLead(lead.id); reloadFolders(); }
    if (disposition === "callback") { setStage("callback"); return; }
    setCountdown(session?.advance_delay_sec ?? 5);
    setStage("countdown");
  }, [pos, reloadCalls, lead, session?.advance_delay_sec, refreshLead, reloadFolders]);

  const finish = useCallback(async (disposition: string) => {
    const callId = p.wrapup?.dbId ?? null;
    await p.finishWrapup(disposition, notes);
    setLastCallId(callId);
    setSavedNotes(notes);
    afterOutcome(disposition);
  }, [p, notes, afterOutcome]);

  // The dialer reports the call ended: if an outcome was already picked during the call, move on.
  const prevPhase = useRef(p.phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = p.phase;
    if (stage !== "dialing" || was === p.phase) return;
    if (p.phase === "wrapup" && p.wrapup) {
      if (p.wrapup.disposition) finish(p.wrapup.disposition);
      else setStage("wrapup");
    } else if (p.phase === "idle" && was !== "idle" && was !== "wrapup") {
      // Dropped straight back to idle without a wrap-up: the call never got logged/connected.
      setStage("ready"); setPaused(true);
      toast.error("The call didn't go through — press Resume to retry or S to skip");
    }
  }, [p.phase, p.wrapup, stage, finish]);

  // Countdown → next lead.
  useEffect(() => {
    if (stage !== "countdown" || paused) return;
    if (countdown <= 0) { goTo(pos + 1); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, paused, countdown, pos, goTo]);

  const live = stage === "dialing" && (p.phase === "connecting" || p.phase === "ringing" || p.phase === "active" || p.phase === "held");

  const pickOutcome = async (d: string) => {
    if (stage === "dialing") {
      if (!p.meta?.dbId) return toast.error("Still connecting — try again in a second");
      if (d === "voicemail" && vm?.url && p.phase === "active") { await p.dropVoicemail(vm.url, vm.id); return; }
      await p.setOutcome(d);
      p.hangup();
      return;
    }
    if (stage === "wrapup") return finish(d);
    if ((stage === "countdown" || stage === "callback") && lastCallId && d !== lastOutcome) {
      // Change of mind: update the saved outcome.
      const r = await updateCallAction(lastCallId, { disposition: d });
      if (!r.ok) return toast.error(r.error);
      afterOutcome(d);
    }
  };

  const skip = () => {
    if (live) return toast.error("Hang up first (or pick an outcome)");
    if (!lead || stage === "done" || stage === "ended") return;
    goTo(pos + 1, stage === "ready" ? lead.id : null);
  };
  const togglePause = () => {
    setPaused((v) => !v);
  };
  const resume = () => {
    setPaused(false);
    if (stage === "ready" && lead) dial(pos);
  };
  const dnc = async () => {
    if (!lead) return;
    const r = await markDncAction(lead.id);
    if (!r.ok) return toast.error(r.error);
    setLeads((ls) => ls.map((x, i) => (i === pos ? { ...x, doNotContact: true } : x)));
    toast.success(`${lead.name} marked Do Not Contact`);
    if (stage === "dialing" || stage === "wrapup") pickOutcome("not_interested");
  };
  const openBooking = () => {
    if (stage === "countdown") setPaused(true);
    setBooking(true);
  };
  /** A meeting got booked from the embedded scheduler: log the call as Interested / Booked (without hanging up). */
  const onBooked = useCallback(async () => {
    if (stage === "dialing" && p.meta?.dbId) await p.setOutcome("interested");
    else if (stage === "wrapup") await finish("interested");
    else if ((stage === "countdown" || stage === "callback") && lastCallId && lastOutcome !== "interested") {
      const r = await updateCallAction(lastCallId, { disposition: "interested" });
      if (r.ok) afterOutcome("interested");
    }
    if (lead) refreshLead(lead.id);
  }, [stage, p, finish, lastCallId, lastOutcome, afterOutcome, lead, refreshLead]);

  const saveCallback = async () => {
    if (!lead) return;
    const r = await createCallbackTaskAction({ contactId: lead.id, dueAt: new Date(callbackAt).toISOString(), note: notes || null, callId: lastCallId });
    if (!r.ok) return toast.error(r.error);
    toast.success("Call back task created");
    setCountdown(session?.advance_delay_sec ?? 5);
    setStage("countdown");
  };
  const sendTemplate = async () => {
    if (!lead || !templateId) return;
    setSending(true);
    const r = await sendTemplateAction({ contactId: lead.id, templateId, from: fromFor(lead) });
    setSending(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.data.channel === "sms" ? "Text sent" : "Email sent");
  };
  const end = async () => {
    setEnding(true);
    if (live) p.hangup();
    if (lastCallId && notes.trim() && notes !== savedNotes) await updateCallAction(lastCallId, { notes: notes.trim() });
    const r = await endSessionAction(id);
    setEnding(false);
    setConfirmEnd(false);
    if (!r.ok) return toast.error(r.error);
    setSummary(r.data);
    setStage("ended");
  };

  // ── Keyboard: 1–6 outcomes, S skip, P pause, D DNC, E end, Enter = start / next now ──
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || stage === "ended" || confirmEnd || booking || editing) return;
    const k = e.key.toLowerCase();
    const i = Number(k) - 1;
    if (i >= 0 && i < KEY_OUTCOMES.length) { e.preventDefault(); pickOutcome(KEY_OUTCOMES[i]); }
    else if (k === "s") { e.preventDefault(); skip(); }
    else if (k === "p") { e.preventDefault(); if (paused) resume(); else togglePause(); }
    else if (k === "d") { e.preventDefault(); dnc(); }
    else if (k === "b" && lead) { e.preventDefault(); openBooking(); }
    else if (k === "e") { e.preventDefault(); setConfirmEnd(true); }
    else if (k === "enter") {
      if (stage === "ready" && lead) { e.preventDefault(); resume(); }
      else if (stage === "countdown") { e.preventDefault(); goTo(pos + 1); }
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ── Render ──
  if (error) return <EmptyState title="Couldn't open this session" description={error} className="h-full" action={<Link href="/dialer"><Button>Back to Power Dialer</Button></Link>} />;
  if (!session) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const liveStats = computeStats(calls, { thresholdSec: session.conversation_threshold_sec, durationSec: (now - new Date(session.started_at).getTime()) / 1000 });
  const from = fromFor(lead);

  if (stage === "ended" && summary) {
    return (
      <Page>
        <PageHeader icon={Zap} title={`Session summary · ${session.name ?? "Dialing session"}`} actions={<>
          <Link href="/cold-calling"><Button size="sm">Cold calling dashboard</Button></Link>
          <Link href="/dialer"><Button size="sm" variant="primary">New session</Button></Link>
        </>} />
        <PageBody className="p-4">
          <p className="mb-3 text-xs text-fg-3">
            <Time value={session.started_at} format="datetime" /> · {session.from_mode === "local" ? "Local presence" : `From ${lineLabel(session.from_number)}`} · {leads.length} leads in queue
          </p>
          <SessionSummary stats={summary} />
        </PageBody>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader icon={Zap} title={session.name ?? "Dialing session"} actions={<>
        <StatusLine />
        <span className="mx-2 h-4 w-px bg-border" />
        <Button size="sm" icon={paused ? Play : Pause} onClick={paused ? resume : togglePause}>{paused ? "Resume" : "Pause"} <Kbd>P</Kbd></Button>
        <Button size="sm" icon={SkipForward} onClick={skip} disabled={live || stage === "done"}>Skip <Kbd>S</Kbd></Button>
        <Button size="sm" variant="danger" icon={Square} onClick={() => setConfirmEnd(true)}>End session <Kbd>E</Kbd></Button>
      </>}>
        <Tag>{Math.min(pos + 1, leads.length)} / {leads.length}</Tag>
      </PageHeader>
      <PageBody className="p-4">
        <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {[
            ["Dials", liveStats.dials], ["Connects", liveStats.connects], ["Conversations", liveStats.conversations],
            ["Talk time", fmtSecs(liveStats.talkSec)], ["Booked", liveStats.appointments], ["Session", fmtSecs(liveStats.durationSec)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border px-3 py-2"><div className="text-[11px] text-fg-3">{k}</div><div className="text-base font-semibold tabular-nums">{v}</div></div>
          ))}
        </div>

        {stage === "done" || !lead ? (
          <Card>
            <EmptyState icon={Zap} title="That's the whole list" description={`Every lead in this session has been dialed or skipped.${held ? ` ${held} lead${held === 1 ? " was" : "s were"} held for calling hours and stay in the list to call later.` : ""} End the session to save your summary.`}
              action={<Button variant="primary" loading={ending} onClick={end}>End session &amp; see summary</Button>} />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <div className="space-y-4">
              {/* Lead card */}
              <Card>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/contacts/${lead.id}`} target="_blank" className="text-lg font-semibold hover:underline">{lead.name}</Link>
                      <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
                      <Tag className="capitalize">{lead.status}</Tag>
                      {lead.doNotContact && <Tag color="red">DNC</Tag>}
                      {lead.phoneBad && <Tag color="red">Bad number</Tag>}
                      {lead.lastOutcome && <Tag color="purple">Last: {dispositionLabel(lead.lastOutcome)}</Tag>}
                      <HealthMeter health={lead.health} label className="ml-1" />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-2">
                      {(lead.company || lead.title) && <span className="inline-flex items-center gap-1"><Building2 className="size-3.5 text-fg-3" />{[lead.title, lead.company].filter(Boolean).join(" · ")}</span>}
                      <span className="inline-flex items-center gap-1 tabular-nums"><Phone className="size-3.5 text-fg-3" />{fmtPhone(lead.phone)}</span>
                      {lead.email && <span className="text-fg-3">{lead.email}</span>}
                    </div>
                    {from && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-fg-3">
                        Calling from {lineLabel(from)}{session.from_mode === "local" ? " (local presence)" : ""}
                        <HealthMeter health={lineHealth.find((h) => h.line === from)} />
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-fg-3">
                      Folder
                      <Select value={lead.folderId ?? folders.find((f) => f.system_key === "new")?.id ?? ""} className="h-7 w-auto text-xs"
                        onChange={async (e) => {
                          const id = e.target.value;
                          const r = await moveToFolderAction([lead.id], id);
                          if (!r.ok) return toast.error(r.error);
                          setLeads((ls) => ls.map((x) => (x.id === lead.id ? { ...x, folderId: id } : x)));
                          reloadFolders();
                        }}>
                        {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </Select>
                    </div>
                    {(() => {
                      const w = callingWindow(lead.phone, settings.callingHours);
                      return <div className={cn("mt-1 text-xs", w.allowed ? "text-fg-3" : "text-warning")}>Their time: {w.localTime} ({w.city}){!w.allowed && ` — outside calling hours ${w.window}`}</div>;
                    })()}
                    {lead.notes && <p className="mt-2 whitespace-pre-wrap rounded-md bg-bg-2 px-2 py-1.5 text-[13px] text-fg-2">{lead.notes}</p>}
                  </div>
                  <CallStatus stage={stage} paused={paused} countdown={countdown} />
                </div>

                {/* Call controls while live */}
                {live && (
                  <div className="mt-3 flex items-center gap-2 border-t border-border-light pt-3">
                    <span className="text-[13px] text-fg-2">
                      {p.phase === "active" || p.phase === "held" ? fmtDuration(Math.round((p.now - (p.meta?.answeredAt ?? p.now)) / 1000)) : p.phase === "ringing" ? "Ringing…" : "Connecting…"}
                    </span>
                    <Button size="sm" icon={p.muted ? MicOff : Mic} onClick={p.toggleMute} disabled={p.phase !== "active" && p.phase !== "held"}>{p.muted ? "Unmute" : "Mute"}</Button>
                    {vm?.url && <Button size="sm" icon={Voicemail} disabled={p.phase !== "active"} onClick={() => pickOutcome("voicemail")} title="Play your recorded voicemail into the call, then hang up">Drop VM “{vm.name}”</Button>}
                    <Button size="sm" variant="danger" icon={PhoneOff} className="ml-auto" onClick={p.hangup}>Hang up</Button>
                  </div>
                )}

                {/* Outcomes */}
                <div className="mt-3 border-t border-border-light pt-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-fg-3">
                    <span>{stage === "wrapup" ? "Call ended — pick an outcome" : live ? "Outcome (ends the call)" : "Outcome"}</span>
                    <button onClick={openBooking} className="ml-auto mr-2 inline-flex items-center gap-1 rounded px-1 font-medium text-accent hover:bg-hover cursor-pointer"><CalendarCheck className="size-3" /> Book meeting <Kbd>B</Kbd></button>
                    <button onClick={dnc} className="inline-flex items-center gap-1 rounded px-1 hover:bg-hover hover:text-danger cursor-pointer"><Ban className="size-3" /> Do Not Contact <Kbd>D</Kbd></button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {DISPOSITIONS.map((d, i) => {
                      const chosen = (lastOutcome ?? p.meta?.disposition ?? p.wrapup?.disposition) === d.value && stage !== "ready";
                      return (
                        <button key={d.value} onClick={() => pickOutcome(d.value)} disabled={stage === "ready"}
                          className={cn("flex h-9 items-center justify-between rounded-md border px-2.5 text-[13px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
                            chosen ? (d.value === "bad_number" ? "border-danger bg-danger text-white" : "border-fg bg-fg text-bg") : "border-border bg-bg-2 hover:bg-hover")}>
                          <span>{d.value === "voicemail" && vm?.url && live ? "Drop VM & hang up" : d.label}</span>
                          <Kbd>{i + 1}</Kbd>
                        </button>
                      );
                    })}
                  </div>
                  {stage === "callback" && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-bg-2 p-2">
                      <label className="text-xs text-fg-3">Call back at
                        <Input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className="mt-1 w-auto" />
                      </label>
                      <Button variant="primary" icon={CalendarClock} onClick={saveCallback}>Create task &amp; continue</Button>
                      <Button variant="ghost" onClick={() => { setCountdown(session.advance_delay_sec); setStage("countdown"); }}>No task</Button>
                    </div>
                  )}
                  <Textarea value={notes} onChange={(e) => { setNotes(e.target.value); if (stage === "countdown") setPaused(true); }}
                    placeholder="Call notes (optional) — typing pauses the countdown" className="mt-3 min-h-16" />
                  <div className="mt-2 flex items-center gap-1.5">
                    <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-8 flex-1 text-xs">
                      <option value="">Follow-up template…</option>
                      {templates.filter((t) => t.channel === "email" ? !!lead.email : !!lead.phone && !lead.smsOptOut).map((t) => <option key={t.id} value={t.id}>{t.channel === "sms" ? "SMS" : "Email"} · {t.name}</option>)}
                    </Select>
                    <Button size="sm" icon={Send} loading={sending} disabled={!templateId} onClick={sendTemplate}>Send</Button>
                  </div>
                  {stage === "ready" && (
                    <Button variant="primary" icon={Phone} className="mt-3 w-full bg-success hover:bg-success hover:opacity-90" onClick={resume}>
                      {calls.length ? "Resume dialing" : "Start dialing"} <Kbd>Enter</Kbd>
                    </Button>
                  )}
                  {stage === "countdown" && (
                    <Button className="mt-3 w-full" icon={ChevronRight} onClick={() => goTo(pos + 1)}>Next lead now <Kbd>Enter</Kbd></Button>
                  )}
                </div>
              </Card>

              {/* History */}
              <Card title="History">
                {!history ? <Spinner /> : !history.calls.length && !history.activities.length ? <p className="text-xs text-fg-3">No previous calls or activity.</p> : (
                  <ul className="space-y-1.5 text-[13px]">
                    {history.calls.map((c) => (
                      <li key={c.id} className="flex gap-2">
                        <Phone className="mt-0.5 size-3.5 shrink-0 text-fg-3" />
                        <span className="flex-1">{c.direction === "inbound" ? "Inbound" : "Outbound"} call · {fmtDuration(c.duration_sec)}{c.disposition && <> · <b className="font-medium">{dispositionLabel(c.disposition)}</b></>}{c.notes && <span className="text-fg-3"> — {c.notes}</span>}</span>
                        <Time value={c.started_at} className="text-xs text-fg-4" />
                      </li>
                    ))}
                    {history.activities.map((a) => (
                      <li key={a.id} className="flex gap-2">
                        <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-fg-4" />
                        <span className="flex-1">{a.title}{a.body && <span className="text-fg-3"> — {a.body.slice(0, 140)}</span>}</span>
                        <Time value={a.created_at} className="text-xs text-fg-4" />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* Queue */}
            <Card title="Up next" padded={false}>
              <ul>
                {leads.slice(pos + 1, pos + 8).map((l, i) => (
                  <li key={l.id} className="flex items-center gap-2 border-b border-border-light px-3 py-2 text-[13px] last:border-0">
                    <span className="w-5 text-xs text-fg-4 tabular-nums">{pos + i + 2}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5"><span className="truncate font-medium">{l.name}</span><HealthMeter health={l.health} /></div>
                      <div className="truncate text-xs text-fg-3">{[l.company, fmtPhone(l.phone)].filter(Boolean).join(" · ")}</div>
                    </div>
                    {l.lastOutcome && <Tag className="shrink-0">{dispositionLabel(l.lastOutcome)}</Tag>}
                  </li>
                ))}
                {pos + 1 >= leads.length && <li className="px-3 py-3 text-xs text-fg-3">This is the last lead.</li>}
              </ul>
              <div className="border-t border-border-light px-3 py-2 text-[11px] leading-relaxed text-fg-4">
                Keys: <Kbd>1</Kbd>–<Kbd>6</Kbd> outcome · <Kbd>B</Kbd> book · <Kbd>S</Kbd> skip · <Kbd>P</Kbd> pause · <Kbd>D</Kbd> DNC · <Kbd>E</Kbd> end · <Kbd>Enter</Kbd> start/next
              </div>
            </Card>
          </div>
        )}
      </PageBody>

      {booking && lead && (
        <BookMeetingDialog lead={lead} from={fromFor(lead)} onClose={() => setBooking(false)} onBooked={onBooked} />
      )}
      {editing && lead && (
        <EditLeadDialog lead={lead} sessionId={id} onClose={() => setEditing(false)}
          onSaved={(patch) => setLeads((ls) => ls.map((x) => (x.id === lead.id ? { ...x, ...patch } : x)))} />
      )}
      <Dialog open={confirmEnd} onOpenChange={setConfirmEnd} size="sm" title="End this session?"
        description={live ? "The current call will be hung up." : "You'll see the session summary next."}
        footer={<><Button onClick={() => setConfirmEnd(false)}>Keep dialing</Button><Button variant="danger" loading={ending} onClick={end}>End session</Button></>} />
    </Page>
  );
}

function CallStatus({ stage, paused, countdown }: { stage: Stage; paused: boolean; countdown: number }) {
  if (stage === "dialing") return <Tag color="green"><Loader2 className="mr-1 inline size-3 animate-spin" />On call</Tag>;
  if (stage === "wrapup") return <Tag color="yellow">Wrap-up</Tag>;
  if (stage === "callback") return <Tag color="yellow">Schedule call back</Tag>;
  if (stage === "countdown") return paused ? <Tag color="gray">Paused</Tag> : <Tag color="blue">Next in {countdown}s</Tag>;
  if (paused) return <Tag color="gray">Paused</Tag>;
  return null;
}
