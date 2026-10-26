"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { createClient } from "@/lib/supabase/client";
import { updateLeadAction, type SessionLead } from "@/lib/actions/dialer";
import { contactLabel } from "@/lib/utils";

/** Fix a lead's details mid-call without leaving the session. */
export function EditLeadDialog({ lead, sessionId, onClose, onSaved }: {
  lead: SessionLead; sessionId: string; onClose: () => void; onSaved: (patch: Partial<SessionLead>) => void;
}) {
  const [f, setF] = useState<{ first_name: string; last_name: string; email: string; phone: string; title: string; company: string; notes: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    createClient().from("contacts").select("first_name, last_name, email, phone, title, company:companies(name)").eq("id", lead.id).maybeSingle().then(({ data }) => {
      const c = data as unknown as { first_name: string | null; last_name: string | null; email: string | null; phone: string | null; title: string | null; company: { name: string } | null } | null;
      setF({
        first_name: c?.first_name ?? "", last_name: c?.last_name ?? "", email: c?.email ?? "", phone: c?.phone ?? lead.phone ?? "",
        title: c?.title ?? "", company: c?.company?.name ?? lead.company ?? "", notes: lead.notes ?? "",
      });
    });
  }, [lead]);

  const save = async () => {
    if (!f) return;
    setSaving(true);
    const r = await updateLeadAction({ contactId: lead.id, sessionId, ...f });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    onSaved({
      name: contactLabel({ first_name: f.first_name, last_name: f.last_name, email: f.email, phone: r.data.phone }),
      email: f.email || null, phone: r.data.phone, title: f.title || null, company: f.company || null, notes: f.notes || null,
      ...(r.data.phoneChanged ? { phoneBad: false } : {}),
    });
    toast.success("Lead updated");
    onClose();
  };

  const set = (k: keyof NonNullable<typeof f>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => (x ? { ...x, [k]: e.target.value } : x));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Edit lead" description="Changes save to the contact right away. You can keep talking."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Save</Button></>}>
      {!f ? <div className="flex justify-center py-6"><Spinner /></div> : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input autoFocus value={f.first_name} onChange={set("first_name")} /></Field>
          <Field label="Last name"><Input value={f.last_name} onChange={set("last_name")} /></Field>
          <Field label="Phone" hint="Changing it clears a bad-number flag"><Input type="tel" value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Company"><Input value={f.company} onChange={set("company")} /></Field>
          <Field label="Job title"><Input value={f.title} onChange={set("title")} /></Field>
          <Field label="Lead notes" className="col-span-2"><Textarea value={f.notes} onChange={set("notes")} className="min-h-20" /></Field>
        </div>
      )}
    </Dialog>
  );
}
