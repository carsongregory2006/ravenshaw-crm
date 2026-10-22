"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { CompanyPicker, ContactPicker, UserPicker } from "./pickers";
import { CONTACT_STATUSES } from "./inline-fields";
import { createContact, createDeal, createCompany } from "@/lib/actions/crm";
import { useIsStaff, useProfile } from "@/components/shell/profile-context";
import type { ContactStatus, PipelineStage } from "@/lib/types";

export function NewContactDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (o: boolean) => void; defaults?: { company_id?: string } }) {
  const router = useRouter();
  const profile = useProfile();
  const staff = useIsStaff();
  const empty = { first_name: "", last_name: "", email: "", phone: "", title: "", source: "manual", status: "lead" as ContactStatus, company_id: defaults?.company_id ?? null as string | null, owner_id: profile.id as string | null };
  const [f, setF] = React.useState(empty);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (open) setF({ ...empty, company_id: defaults?.company_id ?? null }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent, openAfter = true) => {
    e.preventDefault();
    setSaving(true);
    const r = await createContact(f);
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Person created");
    onOpenChange(false);
    if (openAfter) router.push(`/contacts/${r.data.id}`); else router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New person" description="Creating a person triggers any active “Lead created” automations."
      footer={<><Button onClick={(e) => submit(e as unknown as React.FormEvent, false)} loading={saving}>Create</Button><Button variant="primary" type="submit" form="new-contact" loading={saving}>Create & open</Button></>}>
      <form id="new-contact" onSubmit={submit} className="grid grid-cols-2 gap-3 pb-2">
        <Field label="First name"><Input autoFocus value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Field>
        <Field label="Last name"><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="(555) 555-5555" /></Field>
        <Field label="Job title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Company"><CompanyPicker value={f.company_id} onChange={(id) => setF({ ...f, company_id: id })} /></Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ContactStatus })}>
            {CONTACT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Source"><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="referral, facebook, cold call…" /></Field>
        {staff && <Field label="Owner" className="col-span-2"><UserPicker value={f.owner_id} onChange={(id) => setF({ ...f, owner_id: id })} /></Field>}
      </form>
    </Dialog>
  );
}

export function NewDealDialog({ open, onOpenChange, stages, defaults }: {
  open: boolean; onOpenChange: (o: boolean) => void; stages: PipelineStage[];
  defaults?: { contact_id?: string | null; contact_label?: string | null; company_id?: string | null; stage_id?: string; name?: string };
}) {
  const router = useRouter();
  const profile = useProfile();
  const init = () => ({
    name: defaults?.name ?? "", contact_id: defaults?.contact_id ?? null, company_id: defaults?.company_id ?? null,
    owner_id: profile.id as string | null, stage_id: defaults?.stage_id ?? stages.find((s) => !s.is_won && !s.is_lost)?.id ?? stages[0]?.id,
    expected_close_date: "", term_months: "12", source: "", notes: "",
  });
  const [f, setF] = React.useState(init);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (open) setF(init()); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const r = await createDeal({
      name: f.name, contact_id: f.contact_id, company_id: f.company_id, owner_id: f.owner_id, stage_id: f.stage_id,
      expected_close_date: f.expected_close_date || null, term_months: Number(f.term_months) || 12, source: f.source || null, notes: f.notes || null,
    });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(`Deal ${r.data.deal_number} created`);
    onOpenChange(false);
    router.push(`/deals/${r.data.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New deal" description="A deal number is assigned automatically. Add line items on the deal page."
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" type="submit" form="new-deal" loading={saving}>Create deal</Button></>}>
      <form id="new-deal" onSubmit={submit} className="grid grid-cols-2 gap-3 pb-2">
        <Field label="Deal name" className="col-span-2"><Input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="AI receptionist build — Acme Dental" /></Field>
        <Field label="Person"><ContactPicker value={f.contact_id} valueLabel={defaults?.contact_label} onChange={(id) => setF({ ...f, contact_id: id })} /></Field>
        <Field label="Company"><CompanyPicker value={f.company_id} onChange={(id) => setF({ ...f, company_id: id })} /></Field>
        <Field label="Stage">
          <Select value={f.stage_id} onChange={(e) => setF({ ...f, stage_id: e.target.value })}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Owner"><UserPicker value={f.owner_id} onChange={(id) => setF({ ...f, owner_id: id })} /></Field>
        <Field label="Expected close"><Input type="date" value={f.expected_close_date} onChange={(e) => setF({ ...f, expected_close_date: e.target.value })} /></Field>
        <Field label="Term (months)"><Input type="number" min={1} value={f.term_months} onChange={(e) => setF({ ...f, term_months: e.target.value })} /></Field>
        <Field label="Source" className="col-span-2"><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Inbound, referral, outbound…" /></Field>
        <Field label="Notes" className="col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </form>
    </Dialog>
  );
}

export function NewCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [f, setF] = React.useState({ name: "", domain: "", industry: "", employees: "", phone: "", website: "" });
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (open) setF({ name: "", domain: "", industry: "", employees: "", phone: "", website: "" }); }, [open]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const domain = f.domain.trim() || (f.website ? f.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "");
    const r = await createCompany({ name: f.name, domain: domain || null, industry: f.industry || null, employees: f.employees ? Number(f.employees) : null, phone: f.phone || null, website: f.website || null });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Company created");
    onOpenChange(false);
    router.push(`/companies/${r.data.id}`);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New company"
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" type="submit" form="new-company" loading={saving}>Create</Button></>}>
      <form id="new-company" onSubmit={submit} className="grid grid-cols-2 gap-3 pb-2">
        <Field label="Name" className="col-span-2"><Input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Website"><Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://acme.com" /></Field>
        <Field label="Domain"><Input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="acme.com" /></Field>
        <Field label="Industry"><Input value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} /></Field>
        <Field label="Employees"><Input type="number" value={f.employees} onChange={(e) => setF({ ...f, employees: e.target.value })} /></Field>
        <Field label="Phone" className="col-span-2"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      </form>
    </Dialog>
  );
}

/** Small confirm dialog. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Delete", onConfirm, danger = true }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; confirmLabel?: string; onConfirm: () => Promise<void> | void; danger?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} size="sm"
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); onOpenChange(false); }}>{confirmLabel}</Button></>} />
  );
}

/** Prompt for a single text value. */
export function PromptDialog({ open, onOpenChange, title, label, placeholder, confirmLabel = "Save", onSubmit, required }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; label: string; placeholder?: string; confirmLabel?: string; onSubmit: (v: string) => Promise<void> | void; required?: boolean;
}) {
  const [v, setV] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) setV(""); }, [open]);
  const go = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (required && !v.trim()) return;
    setBusy(true); await onSubmit(v.trim()); setBusy(false); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} size="sm"
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => go()} disabled={required && !v.trim()}>{confirmLabel}</Button></>}>
      <form onSubmit={go} className="pb-2"><Field label={label}><Input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} /></Field></form>
    </Dialog>
  );
}

// re-export for convenience
export { ContactPicker };
