"use client";
import { useState } from "react";
import { MessageSquare, Mail, Phone, AlertTriangle, PenSquare } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { contactLabel } from "@/lib/utils";
import { useContactCalls, useContactMessages } from "./hooks";
import { SmsBubble, SmsComposer, useAutoScroll } from "./sms";
import { EmailComposerDialog, EmailItem, replySubject } from "./email";
import { CallList } from "./calls";
import { useDialer } from "./dialer";
import type { Contact } from "@/lib/types";

export function smsBlockReason(c: Contact) {
  if (!c.phone) return "No phone number on this contact — add one to text them.";
  if (c.do_not_contact) return "Marked Do Not Contact.";
  if (c.sms_opt_out) return "This contact opted out of SMS (replied STOP). They must text START to re-subscribe.";
  return null;
}
export function emailBlockReason(c: Contact) {
  if (!c.email) return "No email address on this contact — add one to email them.";
  if (c.do_not_contact) return "Marked Do Not Contact.";
  if (c.email_opt_out) return "This contact unsubscribed from email.";
  return null;
}
export function callBlockReason(c: Contact) {
  if (!c.phone) return "No phone number on this contact.";
  if (c.do_not_contact) return "Marked Do Not Contact.";
  return null;
}

function Warning({ text }: { text: string }) {
  return <div className="flex items-center gap-2 border-b border-border-light bg-warning-soft px-3 py-1.5 text-xs text-warning"><AlertTriangle className="size-3.5" />{text}</div>;
}

function SmsTab({ contact }: { contact: Contact }) {
  const { messages, loading } = useContactMessages(contact.id, "sms");
  const scrollRef = useAutoScroll(messages.length);
  const reason = smsBlockReason(contact);
  return (
    <div className="flex h-[560px] flex-col">
      {reason && contact.phone && <Warning text={reason} />}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {loading ? <div className="flex justify-center py-8"><Spinner /></div>
          : messages.length === 0 ? <EmptyState icon={MessageSquare} title="No texts yet" description={`Start the conversation with ${contactLabel(contact)}.`} />
          : messages.map((m) => <SmsBubble key={m.id} m={m} />)}
      </div>
      <SmsComposer contactId={contact.id} disabledReason={reason} />
    </div>
  );
}

function EmailTab({ contact }: { contact: Contact }) {
  const { messages, loading } = useContactMessages(contact.id, "email");
  const [compose, setCompose] = useState<{ subject: string } | null>(null);
  const reason = emailBlockReason(contact);
  const sorted = [...messages].reverse();
  return (
    <div className="flex flex-col">
      {reason && contact.email && <Warning text={reason} />}
      <div className="flex items-center justify-between px-3 pt-3">
        <span className="text-xs text-fg-3">{messages.length} email{messages.length === 1 ? "" : "s"}</span>
        <Button size="sm" variant="primary" icon={PenSquare} disabled={!!reason} title={reason ?? undefined} onClick={() => setCompose({ subject: "" })}>Compose</Button>
      </div>
      <div className="space-y-2 p-3">
        {loading ? <div className="flex justify-center py-8"><Spinner /></div>
          : sorted.length === 0 ? <EmptyState icon={Mail} title="No emails yet" description={reason ?? "Emails you send and replies you receive show up here with delivery and open tracking."} />
          : sorted.map((m, i) => <EmailItem key={m.id} m={m} defaultOpen={i === 0} onReply={reason ? undefined : (x) => setCompose({ subject: replySubject(x.subject) })} />)}
      </div>
      {compose && contact.email && (
        <EmailComposerDialog open onOpenChange={(o) => !o && setCompose(null)} contactId={contact.id} to={contact.email} initialSubject={compose.subject} />
      )}
    </div>
  );
}

function CallsTab({ contact }: { contact: Contact }) {
  const { calls, loading, reload } = useContactCalls(contact.id);
  const dialer = useDialer();
  const reason = callBlockReason(contact);
  return (
    <CallList calls={calls} loading={loading} onChanged={reload} callDisabled={reason}
      onCall={() => contact.phone && dialer.call({ phone: contact.phone, contactId: contact.id, name: contactLabel(contact) })} />
  );
}

/** SMS / Email / Calls for one contact. Rendered on the person record page. */
export function ContactComms({ contact }: { contact: Contact }) {
  const [tab, setTab] = useState<"sms" | "email" | "calls">("sms");
  return (
    <div className="flex flex-col">
      <Tabs
        value={tab}
        onChange={(t) => setTab(t as typeof tab)}
        tabs={[
          { id: "sms", label: "Texts", icon: MessageSquare },
          { id: "email", label: "Emails", icon: Mail },
          { id: "calls", label: "Calls", icon: Phone },
        ]}
      />
      {tab === "sms" && <SmsTab contact={contact} />}
      {tab === "email" && <EmailTab contact={contact} />}
      {tab === "calls" && <CallsTab contact={contact} />}
    </div>
  );
}
