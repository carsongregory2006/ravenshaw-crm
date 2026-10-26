"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, Copy, Mail, MessageSquare } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { bookingOptionsAction, recordDialerBookingAction, sendBookingLinkAction, type SessionLead } from "@/lib/actions/dialer";

type Options = { defaultUrl: string | null; eventTypes: { name: string; url: string; duration: number }[] };

/**
 * Book the lead into Calendly without leaving the dialer: the scheduler is embedded, prefilled with the lead's
 * details, and a completed booking is recorded on the spot (deal → Booked, calendar, timeline).
 */
export function BookMeetingDialog({ lead, from, onClose, onBooked }: {
  lead: SessionLead; from: string | null; onClose: () => void; onBooked: (when: string) => void;
}) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [url, setUrl] = useState("");
  const [sending, setSending] = useState<"sms" | "email" | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  useEffect(() => {
    bookingOptionsAction().then((r) => {
      if (!r.ok) return toast.error(r.error);
      setOpts(r.data);
      setUrl(r.data.defaultUrl ?? r.data.eventTypes[0]?.url ?? "");
    });
  }, []);

  const prefilled = useMemo(() => {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (lead.name && lead.name !== "Unnamed") u.searchParams.set("name", lead.name);
      if (lead.email) u.searchParams.set("email", lead.email);
      if (lead.phone) u.searchParams.set("a1", lead.phone);
      u.searchParams.set("utm_source", "dialer");
      u.searchParams.set("utm_content", lead.id);
      return u;
    } catch { return null; }
  }, [url, lead]);

  const embedUrl = useMemo(() => {
    if (!prefilled) return null;
    const u = new URL(prefilled);
    u.searchParams.set("embed_domain", window.location.host);
    u.searchParams.set("embed_type", "Inline");
    u.searchParams.set("hide_gdpr_banner", "1");
    return u.toString();
  }, [prefilled]);

  // Calendly's embed posts calendly.event_scheduled when the booking is made.
  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      if (e.origin !== "https://calendly.com" || e.data?.event !== "calendly.event_scheduled") return;
      const inviteeUri = e.data?.payload?.invitee?.uri as string | undefined;
      if (!inviteeUri) return;
      const r = await recordDialerBookingAction(lead.id, inviteeUri);
      if (!r.ok) { toast.error(`Booked in Calendly, but couldn't log it: ${r.error}`); onBooked(""); return; }
      const when = new Date(r.data.startTime).toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      setBooked(when);
      toast.success(`Booked: ${r.data.eventName} · ${when}`);
      onBooked(when);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [lead.id, onBooked]);

  const send = async (channel: "sms" | "email") => {
    if (!prefilled) return;
    setSending(channel);
    const r = await sendBookingLinkAction({ contactId: lead.id, url: prefilled.toString(), channel, from });
    setSending(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(channel === "sms" ? "Booking link texted" : "Booking link emailed");
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title={`Book ${lead.name}`}
      description="Pick a time with them on the call. Their name, email and phone are prefilled."
      footer={<>
        <Button size="sm" variant="ghost" icon={Copy} disabled={!prefilled} className="mr-auto"
          onClick={() => { navigator.clipboard.writeText(prefilled!.toString()); toast.success("Booking link copied"); }}>Copy link</Button>
        <Button size="sm" icon={MessageSquare} loading={sending === "sms"} disabled={!prefilled || !lead.phone || lead.smsOptOut} onClick={() => send("sms")}>Text link</Button>
        <Button size="sm" icon={Mail} loading={sending === "email"} disabled={!prefilled || !lead.email} onClick={() => send("email")}>Email link</Button>
        <Button size="sm" variant="primary" onClick={onClose}>{booked ? "Done" : "Close"}</Button>
      </>}>
      {!opts ? <div className="flex justify-center py-10"><Spinner /></div>
        : !url ? (
          <p className="py-8 text-center text-[13px] text-fg-3">No Calendly link yet. Add your default booking link in Settings → Calendly (or connect the Calendly API token) and it&apos;ll show up here.</p>
        ) : (
          <div className="space-y-2">
            {opts.eventTypes.length > 1 && (
              <Select value={url} onChange={(e) => setUrl(e.target.value)} className="h-8 text-[13px]">
                {opts.eventTypes.map((t) => <option key={t.url} value={t.url}>{t.name} · {t.duration} min</option>)}
                {opts.defaultUrl && !opts.eventTypes.some((t) => t.url === opts.defaultUrl) && <option value={opts.defaultUrl}>Default booking link</option>}
              </Select>
            )}
            {booked ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <CalendarCheck className="size-8 text-success" />
                <div className="text-sm font-semibold">Booked for {booked || "the chosen time"}</div>
                <p className="max-w-sm text-xs text-fg-3">It&apos;s on the calendar, the deal is at Booked, and the call is logged as Interested / Booked. Calendly sends them the confirmation.</p>
              </div>
            ) : embedUrl && <iframe key={embedUrl} src={embedUrl} title="Calendly scheduler" className="h-[560px] w-full rounded-md border border-border bg-white" />}
          </div>
        )}
    </Dialog>
  );
}
