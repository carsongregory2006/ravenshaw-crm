"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { testAi, updateWorkspace } from "@/lib/actions/settings";
import type { WorkspaceSettings } from "@/lib/types";
import { PageTitle, Section, TIMEZONES } from "./section";

const MODELS = [
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-opus-4.1",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
  "meta-llama/llama-3.3-70b-instruct",
];

export function GeneralSettings({ settings }: { settings: WorkspaceSettings }) {
  const [f, setF] = useState({
    name: settings.name,
    timezone: settings.timezone,
    ai_model: settings.ai_model,
    deal_number_prefix: settings.deal_number_prefix,
    invoice_due_days: String(settings.invoice_due_days),
    tax_rate_estimate: String(Number(settings.tax_rate_estimate ?? 0) * 100),
    monthly_overhead_budget: String(settings.monthly_overhead_budget ?? 0),
  });
  const [checklist, setChecklist] = useState<string[]>(settings.onboarding_checklist ?? []);
  const [newStep, setNewStep] = useState("");
  const [pending, start] = useTransition();
  const [testing, setTesting] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = () => start(async () => {
    const prefix = f.deal_number_prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!f.name.trim()) return void toast.error("Workspace name is required");
    if (!prefix) return void toast.error("Deal number prefix is required");
    const r = await updateWorkspace({
      name: f.name.trim(),
      timezone: f.timezone,
      ai_model: f.ai_model.trim() || MODELS[0],
      deal_number_prefix: prefix,
      invoice_due_days: Math.max(0, parseInt(f.invoice_due_days) || 0),
      tax_rate_estimate: Math.max(0, Number(f.tax_rate_estimate) || 0) / 100,
      monthly_overhead_budget: Math.max(0, Number(f.monthly_overhead_budget) || 0),
      onboarding_checklist: checklist.map((s) => s.trim()).filter(Boolean),
    });
    if (r.ok) toast.success("Workspace settings saved"); else toast.error(r.error);
  });

  const test = async () => {
    setTesting(true);
    const r = await testAi(f.ai_model.trim());
    setTesting(false);
    if (r.ok) toast.success(`${f.ai_model} replied in ${r.data.ms}ms`, { description: r.data.text });
    else toast.error(r.error);
  };

  const move = (i: number, d: -1 | 1) => setChecklist((xs) => {
    const j = i + d;
    if (j < 0 || j >= xs.length) return xs;
    const n = [...xs];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  return (
    <>
      <PageTitle title="General" description="Workspace-wide configuration." />
      <Section title="Workspace">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Workspace name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Timezone">
            <Select value={f.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {(TIMEZONES.includes(f.timezone) ? TIMEZONES : [f.timezone, ...TIMEZONES]).map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="AI" description="Model used through OpenRouter for summaries, drafting and automation steps.">
        <div className="flex items-end gap-2">
          <Field label="Model" className="flex-1" hint="Any OpenRouter model slug works.">
            <Input list="ai-models" value={f.ai_model} onChange={(e) => set("ai_model", e.target.value)} />
            <datalist id="ai-models">{MODELS.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
          <Button icon={Sparkles} onClick={test} loading={testing} className="mb-5">Test AI</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {MODELS.map((m) => (
            <button key={m} onClick={() => set("ai_model", m)} className={`rounded-sm border px-1.5 py-0.5 text-xs cursor-pointer ${f.ai_model === m ? "border-accent text-accent" : "border-border text-fg-3 hover:text-fg"}`}>{m}</button>
          ))}
        </div>
      </Section>

      <Section title="Deals & billing">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Deal number prefix" hint={`New deals: ${(f.deal_number_prefix || "RAV").toUpperCase()}-1042. Existing numbers are unchanged.`}>
            <Input value={f.deal_number_prefix} onChange={(e) => set("deal_number_prefix", e.target.value.toUpperCase())} maxLength={8} />
          </Field>
          <Field label="Invoice due (days after issue)"><Input type="number" min={0} value={f.invoice_due_days} onChange={(e) => set("invoice_due_days", e.target.value)} /></Field>
          <Field label="Estimated tax rate (%)" hint="Used for net-profit-after-tax estimates."><Input type="number" min={0} step="0.1" value={f.tax_rate_estimate} onChange={(e) => set("tax_rate_estimate", e.target.value)} /></Field>
          <Field label="Monthly overhead budget ($)" hint="Shown against actual expenses on the P&L."><Input type="number" min={0} value={f.monthly_overhead_budget} onChange={(e) => set("monthly_overhead_budget", e.target.value)} /></Field>
        </div>
      </Section>

      <Section title="Onboarding checklist" description="Steps created for every new client when a contract is signed.">
        <ul className="divide-y divide-border-light rounded-lg border border-border">
          {checklist.map((step, i) => (
            <li key={i} className="flex items-center gap-2 px-2 py-1">
              <span className="w-5 text-right text-xs text-fg-4">{i + 1}</span>
              <input value={step} onChange={(e) => setChecklist((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                className="h-7 flex-1 rounded-sm bg-transparent px-1 text-[13px] outline-none hover:bg-hover focus:bg-hover" />
              <Button size="xs" variant="ghost" icon={ArrowUp} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" />
              <Button size="xs" variant="ghost" icon={ArrowDown} onClick={() => move(i, 1)} disabled={i === checklist.length - 1} aria-label="Move down" />
              <Button size="xs" variant="ghost" icon={Trash2} onClick={() => setChecklist((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove" />
            </li>
          ))}
          {checklist.length === 0 && <li className="px-3 py-3 text-[13px] text-fg-3">No steps yet.</li>}
        </ul>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newStep.trim()) { setChecklist((xs) => [...xs, newStep.trim()]); setNewStep(""); } }}>
          <Input value={newStep} onChange={(e) => setNewStep(e.target.value)} placeholder="Add a step…" />
          <Button type="submit" icon={Plus} disabled={!newStep.trim()}>Add</Button>
        </form>
      </Section>

      <div className="flex justify-end"><Button variant="primary" loading={pending} onClick={save}>Save changes</Button></div>
    </>
  );
}
