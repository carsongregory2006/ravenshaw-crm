"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, RotateCcw, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Field, Select, Switch } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/misc";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { cn, timeAgo } from "@/lib/utils";
import { addRrMember, removeRrMember, resetRrCounts, updateRrMember } from "@/lib/actions/landing";
import type { LandingPage, Profile, RrMember } from "@/lib/types";

const ACCENTS = ["#1961ED", "#7B49E8", "#0F8A78", "#E5484D", "#D1580B", "#111111"];

export type RepLite = Pick<Profile, "id" | "full_name" | "email" | "role" | "available_for_rr" | "avatar_url">;

export function SettingsPanel({
  page, onChange, members, setMembers, reps, defaultCalendly,
}: {
  page: LandingPage;
  onChange: (patch: Partial<LandingPage>) => void;
  members: RrMember[];
  setMembers: (m: RrMember[]) => void;
  reps: RepLite[];
  defaultCalendly: string | null;
}) {
  const [addRep, setAddRep] = useState("");
  const repById = new Map(reps.map((r) => [r.id, r]));
  const activeWeight = members.filter((m) => m.active && repById.get(m.rep_id)?.available_for_rr !== false).reduce((a, m) => a + Math.max(0, m.weight), 0);
  const totalAssigned = members.reduce((a, m) => a + m.assigned_count, 0);

  const add = async () => {
    if (!addRep) return;
    const r = await addRrMember(page.id, addRep, 1);
    if (!r.ok) return toast.error(r.error);
    setMembers([...members.filter((m) => m.rep_id !== addRep), r.data]);
    setAddRep("");
  };
  const patchMember = async (m: RrMember, patch: Partial<RrMember>) => {
    setMembers(members.map((x) => (x.id === m.id ? { ...x, ...patch } : x)));
    const r = await updateRrMember(m.id, patch);
    if (!r.ok) toast.error(r.error);
  };
  const remove = async (m: RrMember) => {
    const r = await removeRrMember(m.id);
    if (!r.ok) return toast.error(r.error);
    setMembers(members.filter((x) => x.id !== m.id));
  };
  const reset = async () => {
    const r = await resetRrCounts(page.id);
    if (!r.ok) return toast.error(r.error);
    setMembers(members.map((m) => ({ ...m, assigned_count: 0, last_assigned_at: null })));
    toast.success("Rotation counters reset");
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SectionTitle>General</SectionTitle>
        <Field label="Page name"><Input value={page.name} onChange={(e) => onChange({ name: e.target.value })} /></Field>
        <Field label="URL" hint="Changing the slug breaks links already shared.">
          <div className="flex items-center">
            <span className="flex h-8 items-center rounded-l-md border border-r-0 border-border bg-bg-3 px-2 text-xs text-fg-3">/p/</span>
            <Input className="rounded-l-none" value={page.slug} onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
          </div>
        </Field>
      </div>

      <div className="space-y-3">
        <SectionTitle>SEO</SectionTitle>
        <Field label="Title"><Input value={page.seo_title ?? ""} onChange={(e) => onChange({ seo_title: e.target.value })} placeholder={page.name} /></Field>
        <Field label="Description" hint={`${(page.seo_description ?? "").length}/160`}>
          <Textarea value={page.seo_description ?? ""} onChange={(e) => onChange({ seo_description: e.target.value })} className="min-h-14" />
        </Field>
      </div>

      <div className="space-y-3">
        <SectionTitle>Theme</SectionTitle>
        <Field label="Accent color">
          <div className="flex items-center gap-1.5">
            {ACCENTS.map((a) => (
              <button key={a} onClick={() => onChange({ theme: { ...page.theme, accent: a } })} aria-label={a}
                className={cn("size-6 rounded-md border-2 cursor-pointer", page.theme.accent?.toLowerCase() === a.toLowerCase() ? "border-fg" : "border-transparent")} style={{ background: a }} />
            ))}
            <input type="color" value={page.theme.accent || "#1961ED"} onChange={(e) => onChange({ theme: { ...page.theme, accent: e.target.value } })}
              className="size-6 cursor-pointer rounded-md border border-border bg-transparent" aria-label="Custom color" />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mode">
            <Select value={page.theme.mode} onChange={(e) => onChange({ theme: { ...page.theme, mode: e.target.value as "light" | "dark" } })}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          </Field>
          <Field label="Font">
            <Select value={page.theme.font} onChange={(e) => onChange({ theme: { ...page.theme, font: e.target.value } })}>
              {["Inter", "system-ui", "Georgia", "Helvetica"].map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <SectionTitle>After form submit</SectionTitle>
        <div className="grid grid-cols-3 gap-1 rounded-md bg-bg-3 p-0.5">
          {(["calendly", "message", "redirect"] as const).map((m) => (
            <button key={m} onClick={() => onChange({ after_submit: m })}
              className={cn("h-7 rounded-[5px] text-xs font-medium capitalize cursor-pointer", page.after_submit === m ? "bg-bg text-fg shadow-sm" : "text-fg-3 hover:text-fg")}>
              {m === "calendly" ? "Book call" : m === "message" ? "Thank you" : "Redirect"}
            </button>
          ))}
        </div>
        {page.after_submit === "calendly" && (
          <Field label="Calendly link" hint={defaultCalendly ? `Leave empty to use the workspace default (${defaultCalendly})` : "Set a link here or a workspace default in Settings."}>
            <Input value={page.calendly_url ?? ""} onChange={(e) => onChange({ calendly_url: e.target.value })} placeholder={defaultCalendly ?? "https://calendly.com/you/strategy-call"} />
          </Field>
        )}
        {page.after_submit === "redirect" && (
          <Field label="Redirect URL"><Input value={page.redirect_url ?? ""} onChange={(e) => onChange({ redirect_url: e.target.value })} placeholder="https://…" /></Field>
        )}
        {page.after_submit !== "redirect" && (
          <Field label="Success message" hint={page.after_submit === "calendly" ? "Shown if no Calendly link is available." : undefined}>
            <Textarea value={page.success_message ?? ""} onChange={(e) => onChange({ success_message: e.target.value })} className="min-h-14" />
          </Field>
        )}
      </div>

      <div className="space-y-3">
        <SectionTitle actions={<Switch checked={page.rr_enabled} onChange={(v) => onChange({ rr_enabled: v })} />}>Round robin</SectionTitle>
        {page.rr_enabled ? (
          <>
            <Field label="Distribution" hint={page.rr_mode === "weighted" ? "Leads split by weight (e.g. 3:1 sends 75% to the first rep)." : "Strict rotation: each available rep gets the next lead in turn."}>
              <Select value={page.rr_mode} onChange={(e) => onChange({ rr_mode: e.target.value as "weighted" | "strict" })}>
                <option value="weighted">Weighted</option>
                <option value="strict">Strict rotation</option>
              </Select>
            </Field>
            <div className="rounded-md border border-border">
              {members.length === 0 && (
                <div className="flex flex-col items-center gap-1 px-3 py-4 text-center text-xs text-fg-3">
                  <Users className="size-4" />
                  No reps in this page&apos;s pool — leads fall back to the global pool, then the default owner.
                </div>
              )}
              {members.map((m) => {
                const rep = repById.get(m.rep_id);
                const unavailable = rep?.available_for_rr === false;
                const share = m.active && !unavailable && activeWeight ? (page.rr_mode === "weighted" ? m.weight / activeWeight : 1 / members.filter((x) => x.active).length) : 0;
                return (
                  <div key={m.id} className="flex items-center gap-2 border-b border-border-light px-2 py-1.5 last:border-b-0">
                    <Avatar name={rep?.full_name || rep?.email} src={rep?.avatar_url} size={20} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">{rep?.full_name || rep?.email || "Unknown"}</div>
                      <div className="text-[11px] text-fg-3">
                        {m.assigned_count} leads{m.last_assigned_at ? ` · last ${timeAgo(m.last_assigned_at)}` : ""}
                        {unavailable && <Tag color="yellow" className="ml-1 h-4">Unavailable</Tag>}
                      </div>
                    </div>
                    {page.rr_mode === "weighted" && (
                      <Input type="number" min={0} max={100} value={m.weight} aria-label="Weight" className="h-7 w-12 px-1 text-center"
                        onChange={(e) => setMembers(members.map((x) => (x.id === m.id ? { ...x, weight: Math.max(0, Number(e.target.value) || 0) } : x)))}
                        onBlur={(e) => patchMember(m, { weight: Math.max(0, Number(e.target.value) || 0) })} />
                    )}
                    <span className="w-9 text-right text-xs tabular-nums text-fg-2">{Math.round(share * 100)}%</span>
                    <Switch checked={m.active} onChange={(v) => patchMember(m, { active: v })} />
                    <Button size="xs" variant="ghost" icon={Trash2} onClick={() => remove(m)} aria-label="Remove rep" />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1.5">
              <Select value={addRep} onChange={(e) => setAddRep(e.target.value)} className="flex-1">
                <option value="">Add a rep…</option>
                {reps.filter((r) => !members.some((m) => m.rep_id === r.id)).map((r) => (
                  <option key={r.id} value={r.id}>{r.full_name || r.email}{r.role !== "sales_rep" ? ` (${r.role})` : ""}</option>
                ))}
              </Select>
              <Button icon={Plus} onClick={add} disabled={!addRep}>Add</Button>
            </div>
            {totalAssigned > 0 && <Button size="xs" variant="ghost" icon={RotateCcw} onClick={reset}>Reset rotation counters</Button>}
          </>
        ) : (
          <p className="text-xs text-fg-3">Round robin is off: every lead goes to the default owner below.</p>
        )}
        <Field label="Default owner" hint="Used when round robin is off or no rep is available.">
          <Select value={page.default_owner_id ?? ""} onChange={(e) => onChange({ default_owner_id: e.target.value || null })}>
            <option value="">Unassigned</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.full_name || r.email}</option>)}
          </Select>
        </Field>
      </div>
    </div>
  );
}
