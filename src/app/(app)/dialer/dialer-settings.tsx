"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock, PhoneIncoming, Recycle } from "lucide-react";
import { Card, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import { useIsStaff } from "@/components/shell/profile-context";
import {
  disableInboundVoicemailAction, enableInboundVoicemailAction, getDialerSettingsAction, inboundStatusAction, saveDialerSettingsAction,
} from "@/lib/actions/dialer";
import { DISPOSITIONS } from "@/lib/dispositions";
import type { DialerSettings } from "@/lib/dialer/settings";
import { lineLabel } from "@/lib/utils";
import type { VoicemailDrop } from "@/lib/types";

type Inbound = { appId: string | null; numbers: { number: string; routing: "voicemail" | "browser" | "other" }[] };

export function DialerSettingsPanel({ voicemails }: { voicemails: VoicemailDrop[] }) {
  const staff = useIsStaff();
  const [s, setS] = useState<DialerSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [inbound, setInbound] = useState<Inbound | null>(null);
  const [routing, setRouting] = useState(false);

  useEffect(() => {
    getDialerSettingsAction().then((r) => (r.ok ? setS(r.data) : toast.error(r.error)));
    inboundStatusAction().then((r) => (r.ok ? setInbound(r.data) : toast.error(r.error)));
  }, []);

  if (!s) return <div className="flex justify-center py-16"><Spinner /></div>;
  const set = <K extends keyof DialerSettings>(k: K, patch: Partial<DialerSettings[K]>) => setS({ ...s, [k]: { ...s[k], ...patch } });

  const save = async () => {
    setSaving(true);
    const r = await saveDialerSettingsAction(s);
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    setS(r.data);
    toast.success("Dialer settings saved");
  };

  const toggleRouting = async (on: boolean) => {
    setRouting(true);
    const r = on ? await enableInboundVoicemailAction() : await disableInboundVoicemailAction();
    setRouting(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(on ? `CRM voicemail on for ${r.data.moved.length} number(s)` : `Voicemail off for ${r.data.moved.length} number(s)`);
    const st = await inboundStatusAction();
    if (st.ok) setInbound(st.data);
  };

  const vmOn = inbound?.numbers.some((n) => n.routing === "voicemail");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {!staff && <p className="rounded-md bg-bg-2 px-3 py-2 text-xs text-fg-3">Only admins can change these settings.</p>}

      <Card title={<span className="inline-flex items-center gap-1.5"><Clock className="size-4 text-fg-3" />Calling hours</span>}
        actions={<Switch checked={s.callingHours.enabled} onChange={(v) => set("callingHours", { enabled: v })} />}>
        <p className="mb-3 text-xs text-fg-3">
          The dialer only calls leads inside these hours <b>in the lead&apos;s local time</b> (worked out from their area code), and holds the rest for later.
          Defaults follow the CRTC telemarketing rules.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Weekdays from"><Input type="time" value={s.callingHours.weekdayStart} onChange={(e) => set("callingHours", { weekdayStart: e.target.value })} /></Field>
          <Field label="Weekdays until"><Input type="time" value={s.callingHours.weekdayEnd} onChange={(e) => set("callingHours", { weekdayEnd: e.target.value })} /></Field>
          <Field label="Weekends from"><Input type="time" value={s.callingHours.weekendStart} onChange={(e) => set("callingHours", { weekendStart: e.target.value })} /></Field>
          <Field label="Weekends until"><Input type="time" value={s.callingHours.weekendEnd} onChange={(e) => set("callingHours", { weekendEnd: e.target.value })} /></Field>
        </div>
      </Card>

      <Card title={<span className="inline-flex items-center gap-1.5"><Recycle className="size-4 text-fg-3" />Recycling</span>}
        actions={<Switch checked={s.recycle.enabled} onChange={(v) => set("recycle", { enabled: v })} />}>
        <p className="mb-3 text-xs text-fg-3">
          Leads with these outcomes go into your <b>Recycled</b> list with the date they were added, ready to call again after the delay. They stop recycling after the max attempts.
        </p>
        <div className="mb-3 flex flex-wrap gap-3">
          {DISPOSITIONS.map((d) => (
            <label key={d.value} className="inline-flex items-center gap-1.5 text-[13px]">
              <Checkbox checked={s.recycle.outcomes.includes(d.value)}
                onChange={(e) => set("recycle", { outcomes: e.target.checked ? [...s.recycle.outcomes, d.value] : s.recycle.outcomes.filter((x) => x !== d.value) })} />
              {d.label}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Call again after (hours)" hint="24 = next day, 72 = three days"><Input type="number" min={0} value={s.recycle.delayHours} onChange={(e) => set("recycle", { delayHours: Number(e.target.value) })} /></Field>
          <Field label="Max attempts"><Input type="number" min={1} max={20} value={s.recycle.maxAttempts} onChange={(e) => set("recycle", { maxAttempts: Number(e.target.value) })} /></Field>
        </div>
      </Card>

      <Card title={<span className="inline-flex items-center gap-1.5"><PhoneIncoming className="size-4 text-fg-3" />Inbound calls &amp; voicemail</span>}>
        <p className="mb-3 text-xs text-fg-3">
          With CRM voicemail on, calls to your numbers ring your browser (Phone → Receive calls) first. If nobody answers in time, or nobody is online, the caller hears your greeting
          and can leave a message. It shows up on the call, with a notification and a missed-call task. Outbound calling isn&apos;t affected.
        </p>
        {!inbound ? <Spinner /> : (
          <div className="mb-3 space-y-1.5">
            {inbound.numbers.map((n) => (
              <div key={n.number} className="flex items-center gap-2 text-[13px]">
                <span className="flex-1">{lineLabel(n.number)}</span>
                {n.routing === "voicemail" ? <Tag color="green">Ring browser → voicemail</Tag> : n.routing === "browser" ? <Tag color="yellow">Ring browser only (no voicemail)</Tag> : <Tag>Other routing</Tag>}
              </div>
            ))}
            <div className="pt-1">
              {vmOn
                ? <Button size="sm" loading={routing} disabled={!staff} onClick={() => toggleRouting(false)}>Turn off CRM voicemail</Button>
                : <Button size="sm" variant="primary" loading={routing} disabled={!staff} onClick={() => toggleRouting(true)}>Turn on CRM voicemail</Button>}
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field label="Ring browser for (sec)"><Input type="number" min={10} max={60} value={s.inbound.ringTimeoutSec} onChange={(e) => set("inbound", { ringTimeoutSec: Number(e.target.value) })} /></Field>
          <Field label="Greeting" hint="Use a recording from Voicemail drops, or have it read out this text.">
            <Select value={s.inbound.greetingDropId ?? ""} onChange={(e) => set("inbound", { greetingDropId: e.target.value || null })}>
              <option value="">Read the text below (text-to-speech)</option>
              {voicemails.map((v) => <option key={v.id} value={v.id}>Recording: {v.name}</option>)}
            </Select>
          </Field>
        </div>
        {!s.inbound.greetingDropId && (
          <Textarea value={s.inbound.greetingText} onChange={(e) => set("inbound", { greetingText: e.target.value })} className="mt-2 min-h-20" />
        )}
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" loading={saving} disabled={!staff} onClick={save}>Save settings</Button>
      </div>
    </div>
  );
}
