"use client";
import { useRef } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import {
  CONTACT_FIELDS, NODE_CATALOG, RULE_KINDS, TRIGGERS, UPDATABLE_FIELDS, MERGE_TAGS, type ConditionRule,
} from "@/lib/automations/catalog";
import type { AutomationNodeType } from "@/lib/types";
import { NODE_ICONS } from "./icons";

export interface Lookups {
  stages: { key: string; name: string }[];
  pages: { id: string; name: string }[];
  reps: { id: string; full_name: string | null; email: string }[];
  templates: { id: string; channel: "sms" | "email"; name: string; subject: string | null; body: string }[];
}

type Cfg = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

function smsSegments(text: string) {
  const unicode = /[^\x00-\x7F]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return { len: text.length, segments: text.length <= single ? 1 : Math.ceil(text.length / multi), unicode };
}

/** Text input/textarea with clickable {{merge_tag}} chips that insert at the cursor. */
function TemplateField({ label, value, onChange, tags, rows, hint, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; tags: string[]; rows?: number; hint?: React.ReactNode; placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const insert = (tag: string) => {
    const el = ref.current;
    const token = `{{${tag}}}`;
    if (!el) return onChange(value + token);
    const s = el.selectionStart ?? value.length;
    const e = el.selectionEnd ?? value.length;
    onChange(value.slice(0, s) + token + value.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };
  return (
    <Field label={label} hint={hint}>
      {rows ? (
        <Textarea ref={ref} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input ref={ref} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        {tags.map((t) => (
          <button key={t} type="button" onClick={() => insert(t)}
            className="rounded-sm bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-fg-2 hover:bg-accent-soft hover:text-accent cursor-pointer">
            {`{{${t}}}`}
          </button>
        ))}
      </div>
    </Field>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div>
        <div className="text-[13px] text-fg">{label}</div>
        {hint && <div className="text-xs text-fg-3">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

export function ConfigPanel({
  nodeId, type, config, onChange, onDelete, onClose, lookups, aiVars, allowReentry, onAllowReentry, issues,
}: {
  nodeId: string;
  type: AutomationNodeType;
  config: Cfg;
  onChange: (patch: Cfg) => void;
  onDelete: () => void;
  onClose: () => void;
  lookups: Lookups;
  aiVars: string[];
  allowReentry: boolean;
  onAllowReentry: (v: boolean) => void;
  issues: string[];
}) {
  const meta = NODE_CATALOG[type];
  const Icon = NODE_ICONS[type];
  const tags = [...MERGE_TAGS, ...aiVars.map((v) => `ai.${v}`)];
  const set = (k: string) => (v: unknown) => onChange({ [k]: v });

  const templatePicker = (channel: "sms" | "email") => {
    const list = lookups.templates.filter((t) => t.channel === channel);
    if (!list.length) return null;
    return (
      <Field label="Start from a saved template">
        <Select value="" onChange={(e) => {
          const t = list.find((x) => x.id === e.target.value);
          if (!t) return;
          onChange(channel === "sms" ? { message: t.body } : { subject: t.subject ?? "", body: t.body });
        }}>
          <option value="">Choose template…</option>
          {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
    );
  };

  let body: React.ReactNode = null;
  switch (type) {
    case "trigger": {
      const tt = str(config.trigger_type);
      body = (
        <>
          <Field label="Start this workflow when…" hint={TRIGGERS.find((t) => t.value === tt)?.description}>
            <Select value={tt} onChange={(e) => set("trigger_type")(e.target.value)}>
              {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          {(tt === "form_submitted" || tt === "lead_created") && (
            <Field label="Only for landing page" hint="Leave as “Any” to run for every source.">
              <Select value={str(config.page_id)} onChange={(e) => set("page_id")(e.target.value || undefined)}>
                <option value="">Any landing page / source</option>
                {lookups.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          )}
          {tt === "lead_created" && (
            <Field label="Only for lead source (optional)" hint="Matches the contact's source field exactly, e.g. landing_page, manual, calendly, import.">
              <Input value={str(config.source)} onChange={(e) => set("source")(e.target.value || undefined)} placeholder="Any source" />
            </Field>
          )}
          {tt === "stage_changed" && (
            <Field label="When deal moves to">
              <Select value={str(config.stage_key)} onChange={(e) => set("stage_key")(e.target.value || undefined)}>
                <option value="">Any stage</option>
                {lookups.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </Select>
            </Field>
          )}
          {tt === "tag_added" && (
            <Field label="Tag"><Input value={str(config.tag)} onChange={(e) => set("tag")(e.target.value)} placeholder="e.g. no-show" /></Field>
          )}
          {tt === "inbound_sms" && (
            <Field label="Only if message contains (optional)"><Input value={str(config.keyword)} onChange={(e) => set("keyword")(e.target.value || undefined)} placeholder="e.g. INFO" /></Field>
          )}
          <div className="mt-2 space-y-1 border-t border-border-light pt-3">
            <Toggle label="Stop when contact replies" hint="Cancels this sequence for a contact as soon as they text or email back."
              checked={config.stop_on_reply !== false} onChange={(v) => set("stop_on_reply")(v)} />
            <Toggle label="Allow re-entry" hint="Let a contact go through this workflow more than once."
              checked={allowReentry} onChange={onAllowReentry} />
          </div>
        </>
      );
      break;
    }

    case "send_sms": {
      const sms = smsSegments(str(config.message));
      body = (
        <>
          {templatePicker("sms")}
          <TemplateField label="Message" rows={6} value={str(config.message)} onChange={set("message")} tags={tags}
            hint={<span className={sms.segments > 2 ? "text-warning" : ""}>{sms.len} chars · {sms.segments} segment{sms.segments > 1 ? "s" : ""}{sms.unicode ? " · unicode" : ""}</span>} />
          <Toggle label="Respect quiet hours" hint="Hold messages outside 8am–8pm (workspace timezone) until morning." checked={!!config.quiet_hours} onChange={set("quiet_hours")} />
          <Toggle label="Stop workflow if sending fails" hint="Otherwise the error is logged and the sequence continues." checked={!!config.stop_on_error} onChange={set("stop_on_error")} />
        </>
      );
      break;
    }

    case "send_email":
      body = (
        <>
          {templatePicker("email")}
          <TemplateField label="Subject" value={str(config.subject)} onChange={set("subject")} tags={tags} />
          <TemplateField label="Body" rows={10} value={str(config.body)} onChange={set("body")} tags={tags} hint="Plain text — links are auto-linked and wrapped in your branded template." />
          <Toggle label="Respect quiet hours" hint="Hold emails outside 8am–8pm until morning." checked={!!config.quiet_hours} onChange={set("quiet_hours")} />
          <Toggle label="Stop workflow if sending fails" checked={!!config.stop_on_error} onChange={set("stop_on_error")} />
        </>
      );
      break;

    case "wait":
      body = (
        <>
          <div className="flex gap-2">
            <Field label="Wait for" className="flex-1">
              <Input type="number" min={0} value={str(config.amount)} onChange={(e) => set("amount")(Number(e.target.value))} />
            </Field>
            <Field label="Unit" className="flex-1">
              <Select value={str(config.unit) || "days"} onChange={(e) => set("unit")(e.target.value)}>
                <option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option>
              </Select>
            </Field>
          </div>
          <Field label="Then wait until time of day (optional)" hint="e.g. 10:00 — sends land mid-morning in your workspace timezone.">
            <div className="flex gap-2">
              <Input type="time" value={str(config.until_time)} onChange={(e) => set("until_time")(e.target.value)} />
              {!!config.until_time && <Button variant="ghost" icon={X} onClick={() => set("until_time")("")} aria-label="Clear time" />}
            </div>
          </Field>
          <Toggle label="Weekdays only" hint="Push to Monday if it lands on a weekend." checked={!!config.weekdays_only} onChange={set("weekdays_only")} />
          <Toggle label="Business hours only" hint="Mon–Fri, 9am–5pm." checked={!!config.business_hours} onChange={set("business_hours")} />
        </>
      );
      break;

    case "condition": {
      const rules = ((config.rules as ConditionRule[]) ?? []);
      const setRules = (r: ConditionRule[]) => onChange({ rules: r });
      const update = (i: number, patch: Partial<ConditionRule>) => setRules(rules.map((r, j) => (j === i ? ({ ...r, ...patch } as ConditionRule) : r)));
      body = (
        <>
          <Field label="Go down the Yes branch when">
            <Select value={str(config.match) || "all"} onChange={(e) => set("match")(e.target.value)}>
              <option value="all">ALL rules match</option>
              <option value="any">ANY rule matches</option>
            </Select>
          </Field>
          <div className="space-y-2">
            {rules.map((r, i) => (
              <div key={i} className="space-y-2 rounded-md border border-border p-2">
                <div className="flex gap-1">
                  <Select value={r.kind} onChange={(e) => {
                    const k = e.target.value as ConditionRule["kind"];
                    const fresh: Record<string, ConditionRule> = {
                      field: { kind: "field", field: "status", op: "equals", value: "" }, has_tag: { kind: "has_tag", tag: "" },
                      stage_is: { kind: "stage_is", stage_key: lookups.stages[0]?.key ?? "" }, replied: { kind: "replied" }, opened_email: { kind: "opened_email" }, booked: { kind: "booked" },
                    };
                    setRules(rules.map((x, j) => (j === i ? fresh[k] : x)));
                  }}>
                    {RULE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </Select>
                  <Button variant="ghost" icon={Trash2} onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remove rule" />
                </div>
                {r.kind === "has_tag" && (
                  <div className="flex gap-1">
                    <Select className="w-28" value={r.negate ? "no" : "yes"} onChange={(e) => update(i, { negate: e.target.value === "no" })}>
                      <option value="yes">has</option><option value="no">doesn&apos;t have</option>
                    </Select>
                    <Input value={r.tag} onChange={(e) => update(i, { tag: e.target.value })} placeholder="tag" />
                  </div>
                )}
                {r.kind === "stage_is" && (
                  <Select value={r.stage_key} onChange={(e) => update(i, { stage_key: e.target.value })}>
                    {lookups.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                  </Select>
                )}
                {r.kind === "field" && (
                  <div className="grid grid-cols-2 gap-1">
                    <Select value={r.field} onChange={(e) => update(i, { field: e.target.value })}>
                      {CONTACT_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </Select>
                    <Select value={r.op} onChange={(e) => update(i, { op: e.target.value as "equals" })}>
                      <option value="equals">equals</option><option value="not_equals">does not equal</option><option value="contains">contains</option>
                      <option value="is_empty">is empty</option><option value="is_not_empty">is not empty</option>
                    </Select>
                    {r.op !== "is_empty" && r.op !== "is_not_empty" && (
                      <Input className="col-span-2" value={r.value ?? ""} onChange={(e) => update(i, { value: e.target.value })} placeholder="value" />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button icon={Plus} onClick={() => setRules([...rules, { kind: "replied" }])}>Add rule</Button>
          <p className="text-xs text-fg-3">“Replied”, “booked” and “opened” only count activity since the contact entered this workflow.</p>
        </>
      );
      break;
    }

    case "update_contact":
      body = (
        <>
          <Field label="Field">
            <Select value={str(config.field)} onChange={(e) => set("field")(e.target.value)}>
              {CONTACT_FIELDS.filter((f) => UPDATABLE_FIELDS.includes(f.value)).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </Field>
          {config.field === "status" ? (
            <Field label="Value">
              <Select value={str(config.value)} onChange={(e) => set("value")(e.target.value)}>
                {["lead", "prospect", "client", "churned", "unqualified"].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          ) : config.field === "do_not_contact" ? (
            <Field label="Value">
              <Select value={str(config.value) || "true"} onChange={(e) => set("value")(e.target.value)}>
                <option value="true">Yes</option><option value="false">No</option>
              </Select>
            </Field>
          ) : (
            <TemplateField label="Value" value={str(config.value)} onChange={set("value")} tags={tags} />
          )}
        </>
      );
      break;

    case "add_tag":
    case "remove_tag":
      body = <Field label="Tag"><Input value={str(config.tag)} onChange={(e) => set("tag")(e.target.value)} placeholder="e.g. hot-lead" /></Field>;
      break;

    case "assign_owner":
      body = (
        <>
          <Field label="Assign to" hint="Round robin uses the contact's landing page pool (falls back to the global pool).">
            <Select value={str(config.mode) || "round_robin"} onChange={(e) => set("mode")(e.target.value)}>
              <option value="round_robin">Round robin</option>
              <option value="user">Specific rep</option>
            </Select>
          </Field>
          {config.mode === "user" && (
            <Field label="Rep">
              <Select value={str(config.user_id)} onChange={(e) => set("user_id")(e.target.value)}>
                <option value="">Choose rep…</option>
                {lookups.reps.map((r) => <option key={r.id} value={r.id}>{r.full_name || r.email}</option>)}
              </Select>
            </Field>
          )}
        </>
      );
      break;

    case "create_task":
      body = (
        <>
          <TemplateField label="Title" value={str(config.title)} onChange={set("title")} tags={tags} />
          <TemplateField label="Description" rows={3} value={str(config.description)} onChange={set("description")} tags={tags} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Due in (days)"><Input type="number" min={0} value={str(config.due_days)} onChange={(e) => set("due_days")(Number(e.target.value))} /></Field>
            <Field label="Priority">
              <Select value={str(config.priority) || "medium"} onChange={(e) => set("priority")(e.target.value)}>
                {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Assignee">
            <Select value={str(config.assignee) || "owner"} onChange={(e) => set("assignee")(e.target.value)}>
              <option value="owner">Contact owner</option>
              {lookups.reps.map((r) => <option key={r.id} value={r.id}>{r.full_name || r.email}</option>)}
            </Select>
          </Field>
        </>
      );
      break;

    case "move_stage":
      body = (
        <>
          <Field label="Move deal to">
            <Select value={str(config.stage_key)} onChange={(e) => set("stage_key")(e.target.value)}>
              {lookups.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </Select>
          </Field>
          <Toggle label="Create a deal if none exists" checked={config.create_if_missing !== false} onChange={set("create_if_missing")} />
        </>
      );
      break;

    case "notify":
      body = (
        <>
          <Field label="Notify">
            <Select value={str(config.to) || "owner"} onChange={(e) => set("to")(e.target.value)}>
              <option value="owner">Contact owner</option><option value="admins">Admins</option><option value="both">Owner + admins</option>
            </Select>
          </Field>
          <TemplateField label="Title" value={str(config.title)} onChange={set("title")} tags={tags} />
          <TemplateField label="Details" rows={3} value={str(config.body)} onChange={set("body")} tags={tags} />
        </>
      );
      break;

    case "ai_generate":
      body = (
        <>
          <TemplateField label="Prompt" rows={7} value={str(config.prompt)} onChange={set("prompt")} tags={tags}
            hint="Runs through OpenRouter with your workspace model." />
          <Field label="Save result as" hint={<>Use <code className="font-mono">{`{{ai.${str(config.variable) || "name"}}}`}</code> in later SMS/email steps.</>}>
            <Input value={str(config.variable)} onChange={(e) => set("variable")(e.target.value.replace(/[^\w]/g, ""))} placeholder="followup" />
          </Field>
          <Field label="System instructions (optional)">
            <Textarea rows={3} value={str(config.system)} onChange={(e) => set("system")(e.target.value)} placeholder="Default: warm, concise sales follow-up writer." />
          </Field>
        </>
      );
      break;

    case "webhook":
      body = (
        <>
          <Field label="URL"><Input value={str(config.url)} onChange={(e) => set("url")(e.target.value)} placeholder="https://hooks.zapier.com/…" /></Field>
          <Field label="Method">
            <Select value={str(config.method) || "POST"} onChange={(e) => set("method")(e.target.value)}>
              <option>POST</option><option>PUT</option>
            </Select>
          </Field>
          <p className="text-xs text-fg-3">Sends JSON: automation_id, run_id, contact, deal_id and run context. Non-2xx responses fail the run.</p>
        </>
      );
      break;

    case "end":
      body = <p className="text-[13px] text-fg-2">The contact exits the workflow here and the run is marked completed.</p>;
      break;
  }

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[380px] max-w-full flex-col border-l border-border bg-bg shadow-lg">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-light px-3">
        <span className="flex size-6 items-center justify-center rounded-md" style={{ background: meta.color + "1f", color: meta.color }}><Icon className="size-3.5" /></span>
        <input
          value={str(config.label)}
          placeholder={meta.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-fg"
          aria-label="Step name"
        />
        {type !== "trigger" && <Button size="xs" variant="ghost" icon={Trash2} onClick={onDelete} aria-label="Delete step" />}
        <Button size="xs" variant="ghost" icon={X} onClick={onClose} aria-label="Close panel" />
      </div>
      {issues.length > 0 && (
        <div className="border-b border-border-light bg-danger-soft px-3 py-2 text-xs text-danger">
          {issues.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">{body}</div>
      <div className="border-t border-border-light px-3 py-2 text-[10px] text-fg-4">Step id: {nodeId}</div>
    </div>
  );
}
