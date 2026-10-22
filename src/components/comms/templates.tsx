"use client";
import { useState } from "react";
import { Braces, FileText, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { saveTemplateAction } from "@/lib/actions/comms";
import { useTemplates } from "./hooks";
import type { Channel, Template } from "@/lib/types";

export const MERGE_TAGS = [
  { tag: "{{first_name}}", label: "First name" },
  { tag: "{{last_name}}", label: "Last name" },
  { tag: "{{full_name}}", label: "Full name" },
  { tag: "{{company}}", label: "Company" },
  { tag: "{{rep_name}}", label: "Rep name" },
  { tag: "{{agency_name}}", label: "Agency name" },
  { tag: "{{booking_link}}", label: "Booking link" },
];

export function MergeTagMenu({ onInsert }: { onInsert: (tag: string) => void }) {
  return (
    <Menu>
      <MenuTrigger asChild><Button size="xs" variant="ghost" icon={Braces} title="Insert merge tag">Tags</Button></MenuTrigger>
      <MenuContent>
        <MenuLabel>Insert merge tag</MenuLabel>
        {MERGE_TAGS.map((t) => <MenuItem key={t.tag} onSelect={() => onInsert(t.tag)} shortcut={t.tag.replace(/[{}]/g, "")}>{t.label}</MenuItem>)}
      </MenuContent>
    </Menu>
  );
}

export function TemplatePicker({ channel, onPick }: { channel: Channel; onPick: (t: Template) => void }) {
  const { templates, reload } = useTemplates(channel);
  return (
    <Menu onOpenChange={(o) => o && reload()}>
      <MenuTrigger asChild><Button size="xs" variant="ghost" icon={FileText}>Templates</Button></MenuTrigger>
      <MenuContent width={240}>
        <MenuLabel>{channel === "sms" ? "SMS" : "Email"} templates</MenuLabel>
        {templates.length === 0 && <div className="px-2 py-2 text-xs text-fg-3">No templates yet. Use “Save as template” or Settings → Templates.</div>}
        {templates.map((t) => <MenuItem key={t.id} onSelect={() => onPick(t)}>{t.name}</MenuItem>)}
        <MenuSeparator />
        <MenuItem onSelect={() => window.open("/settings?tab=templates", "_self")}>Manage templates…</MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function SaveTemplateButton({ channel, subject, body }: { channel: Channel; subject?: string; body: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const r = await saveTemplateAction({ channel, name, subject: subject ?? null, body });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Template saved");
    setOpen(false);
    setName("");
  };
  return (
    <>
      <Button size="xs" variant="ghost" icon={Save} disabled={!body.trim()} onClick={() => setOpen(true)} title="Save as template">Save</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Save as template" size="sm"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={saving} disabled={!name.trim()} onClick={save}>Save template</Button></>}>
        <Field label="Template name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Follow-up after no-show" onKeyDown={(e) => e.key === "Enter" && name.trim() && save()} /></Field>
        <p className="mt-2 line-clamp-4 whitespace-pre-wrap rounded-md bg-bg-3 p-2 text-xs text-fg-2">{body}</p>
      </Dialog>
    </>
  );
}
