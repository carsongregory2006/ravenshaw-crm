"use client";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Field, Select, Checkbox } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/misc";
import type { LandingSection } from "@/lib/types";
import { FORM_FIELD_LABELS, SECTION_LABELS } from "./templates";

/** Editable list of objects (features, testimonials, FAQs, stats…). */
function ListEditor<T extends Record<string, string | undefined>>({
  label, items, onChange, fields, blank, max = 12,
}: {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  fields: { key: keyof T & string; label: string; multiline?: boolean; placeholder?: string }[];
  blank: T;
  max?: number;
}) {
  const update = (i: number, key: string, value: string) => onChange(items.map((it, j) => (j === i ? { ...it, [key]: value } : it)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <div>
      <SectionTitle actions={items.length < max && <Button size="xs" variant="ghost" icon={Plus} onClick={() => onChange([...items, { ...blank }])}>Add</Button>}>
        {label} ({items.length})
      </SectionTitle>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="group space-y-1.5 rounded-md border border-border-light bg-bg-2 p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-fg-3">#{i + 1}</span>
              <div className="flex gap-0.5 opacity-60 group-hover:opacity-100">
                <Button size="xs" variant="ghost" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" />
                <Button size="xs" variant="ghost" icon={ArrowDown} disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down" />
                <Button size="xs" variant="ghost" icon={Trash2} onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove" />
              </div>
            </div>
            {fields.map((f) =>
              f.multiline ? (
                <Textarea key={f.key} value={it[f.key] ?? ""} placeholder={f.placeholder ?? f.label} onChange={(e) => update(i, f.key, e.target.value)} className="min-h-14" />
              ) : (
                <Input key={f.key} value={it[f.key] ?? ""} placeholder={f.placeholder ?? f.label} onChange={(e) => update(i, f.key, e.target.value)} />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Text({ label, value, onChange, multiline, placeholder, hint }: { label: string; value?: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      {multiline
        ? <Textarea value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <Input value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

const ALL_FORM_FIELDS = ["first_name", "last_name", "email", "phone", "company", "website", "message"] as const;

export function SectionEditor({ section, onChange }: { section: LandingSection; onChange: (s: LandingSection) => void }) {
  const s = section;
  // sections are a discriminated union; the type-specific JSX below guarantees valid keys
  const set = (k: string, v: unknown) => onChange({ ...s, [k]: v } as LandingSection);

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-3">{SECTION_LABELS[s.type]}</div>
      {s.type === "hero" && (
        <>
          <Text label="Headline" value={s.headline} onChange={(v) => set("headline", v)} multiline />
          <Text label="Subheadline" value={s.subheadline} onChange={(v) => set("subheadline", v)} multiline />
          <Text label="Button text" value={s.cta} onChange={(v) => set("cta", v)} hint="Scrolls to the form (or opens Calendly if the page has no form). Leave empty to hide." />
          <Text label="Image URL" value={s.image} onChange={(v) => set("image", v)} placeholder="https://…" />
          <Field label="Alignment">
            <Select value={s.align ?? "center"} onChange={(e) => set("align", e.target.value as "left" | "center")}>
              <option value="center">Centered</option>
              <option value="left">Left</option>
            </Select>
          </Field>
        </>
      )}
      {s.type === "features" && (
        <>
          <Text label="Heading" value={s.heading} onChange={(v) => set("heading", v)} />
          <ListEditor label="Features" items={s.items} onChange={(v) => set("items", v)} blank={{ title: "", body: "", icon: "" }}
            fields={[{ key: "title", label: "Title" }, { key: "body", label: "Description", multiline: true }, { key: "icon", label: "Icon", placeholder: "Emoji or short text (optional)" }]} />
        </>
      )}
      {s.type === "social_proof" && (
        <>
          <Text label="Heading" value={s.heading} onChange={(v) => set("heading", v)} />
          <Text label="Logos" value={(s.logos ?? []).join("\n")} multiline hint="One per line: a company name or an image URL."
            onChange={(v) => set("logos", v.split("\n").map((x) => x.trim()).filter(Boolean))} />
          <ListEditor label="Testimonials" items={s.testimonials ?? []} onChange={(v) => set("testimonials", v)} blank={{ quote: "", name: "", role: "" }}
            fields={[{ key: "quote", label: "Quote", multiline: true }, { key: "name", label: "Name" }, { key: "role", label: "Role / company" }]} />
        </>
      )}
      {s.type === "stats" && (
        <ListEditor label="Stats" items={s.items} onChange={(v) => set("items", v)} blank={{ value: "", label: "" }} max={6}
          fields={[{ key: "value", label: "Value", placeholder: "e.g. 40+" }, { key: "label", label: "Label" }]} />
      )}
      {s.type === "faq" && (
        <>
          <Text label="Heading" value={s.heading} onChange={(v) => set("heading", v)} />
          <ListEditor label="Questions" items={s.items} onChange={(v) => set("items", v)} blank={{ q: "", a: "" }} max={20}
            fields={[{ key: "q", label: "Question" }, { key: "a", label: "Answer", multiline: true }]} />
        </>
      )}
      {s.type === "form" && (
        <>
          <Text label="Heading" value={s.heading} onChange={(v) => set("heading", v)} />
          <Text label="Subheading" value={s.subheading} onChange={(v) => set("subheading", v)} multiline />
          <Text label="Button text" value={s.button} onChange={(v) => set("button", v)} />
          <div>
            <SectionTitle>Fields</SectionTitle>
            <div className="space-y-1">
              {ALL_FORM_FIELDS.map((f) => (
                <label key={f} className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-[13px] hover:bg-hover">
                  <Checkbox
                    checked={s.fields.includes(f)}
                    disabled={f === "email" && s.fields.includes("email") && !s.fields.includes("phone")}
                    onChange={(e) => set("fields", e.target.checked ? ALL_FORM_FIELDS.filter((x) => x === f || s.fields.includes(x)) : s.fields.filter((x) => x !== f))}
                  />
                  {FORM_FIELD_LABELS[f]}
                  {f === "email" && <span className="ml-auto text-xs text-fg-4">email or phone required</span>}
                </label>
              ))}
            </div>
          </div>
          <p className="text-xs text-fg-3">What happens after submit is set in <b>Page settings</b>.</p>
        </>
      )}
      {s.type === "cta" && (
        <>
          <Text label="Headline" value={s.headline} onChange={(v) => set("headline", v)} />
          <Text label="Body" value={s.body} onChange={(v) => set("body", v)} multiline />
          <Text label="Button text" value={s.button} onChange={(v) => set("button", v)} />
        </>
      )}
      {s.type === "video" && (
        <>
          <Text label="Heading" value={s.heading} onChange={(v) => set("heading", v)} />
          <Text label="Video URL" value={s.url} onChange={(v) => set("url", v)} placeholder="YouTube, Vimeo or Loom link" />
        </>
      )}
      {s.type === "rich_text" && (
        <Field label="Content (Markdown)">
          <Textarea value={s.markdown} onChange={(e) => set("markdown", e.target.value)} className="min-h-64 font-mono text-xs" />
        </Field>
      )}
    </div>
  );
}

/** One-line summary used in the sections list. */
export function sectionSummary(s: LandingSection) {
  switch (s.type) {
    case "hero": return s.headline;
    case "cta": return s.headline;
    case "features": return s.heading || `${s.items.length} features`;
    case "social_proof": return s.heading || `${s.testimonials?.length ?? 0} testimonials`;
    case "stats": return s.items.map((i) => i.value).join(" · ");
    case "faq": return s.heading || `${s.items.length} questions`;
    case "form": return s.heading || "Lead form";
    case "video": return s.heading || s.url;
    case "rich_text": return s.markdown.replace(/[#*_>`-]/g, "").trim().slice(0, 60);
  }
}
