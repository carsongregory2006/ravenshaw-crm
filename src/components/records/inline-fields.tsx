"use client";
import * as React from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tag, type TagColor } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const CONTACT_STATUSES = [
  { value: "lead", label: "Lead" },
  { value: "prospect", label: "Prospect" },
  { value: "client", label: "Client" },
  { value: "churned", label: "Churned" },
  { value: "unqualified", label: "Unqualified" },
] as const;

const cellBase = "flex min-h-7 w-full items-center rounded-sm px-1.5 -mx-1.5 text-[13px] cursor-pointer hover:bg-hover";

/** Click-to-edit text. Saves on Enter / blur, Esc cancels. */
export function InlineText({ value, onSave, placeholder = "Empty", type = "text", multiline, display, className }: {
  value: string | number | null | undefined;
  onSave: (v: string) => Promise<unknown> | void;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "number" | "url" | "date";
  multiline?: boolean;
  display?: React.ReactNode;
  className?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value == null ? "" : String(value));
  React.useEffect(() => { if (!editing) setDraft(value == null ? "" : String(value)); }, [value, editing]);

  const commit = async () => {
    setEditing(false);
    if (draft === (value == null ? "" : String(value))) return;
    await onSave(draft);
  };

  if (editing) {
    const common = {
      autoFocus: true,
      value: draft,
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") { setDraft(value == null ? "" : String(value)); setEditing(false); }
        if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.target as HTMLElement).blur(); }
      },
      className: "w-full rounded-sm border border-accent bg-bg px-1.5 text-[13px] outline-none ring-2 ring-accent/15 -mx-1.5",
    };
    return multiline
      ? <textarea {...common} rows={4} onChange={(e) => setDraft(e.target.value)} className={cn(common.className, "py-1")} />
      : <input {...common} type={type} onChange={(e) => setDraft(e.target.value)} className={cn(common.className, "h-7")} />;
  }
  return (
    <div role="button" tabIndex={0} onClick={() => setEditing(true)} onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
      className={cn(cellBase, multiline && "items-start py-1 whitespace-pre-wrap", className)}>
      {value != null && value !== "" ? (display ?? <span className="truncate">{String(value)}</span>) : <span className="text-fg-4">{placeholder}</span>}
    </div>
  );
}

/** Click-to-open select rendered as a tag. */
export function InlineSelect<T extends string>({ value, options, onSave, colors, placeholder = "Empty" }: {
  value: T | null | undefined;
  options: readonly { value: T; label: string }[];
  onSave: (v: T) => Promise<unknown> | void;
  colors?: Partial<Record<T, TagColor>>;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div role="button" tabIndex={0} className={cellBase}>
          {cur ? <Tag color={colors?.[cur.value] ?? "gray"}>{cur.label}</Tag> : <span className="text-fg-4">{placeholder}</span>}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => { setOpen(false); if (o.value !== value) onSave(o.value); }}
            className={cn("flex h-8 w-full items-center rounded-md px-2 hover:bg-hover cursor-pointer", o.value === value && "bg-hover")}>
            <Tag color={colors?.[o.value] ?? "gray"}>{o.label}</Tag>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export const STATUS_COLORS: Record<string, TagColor> = { lead: "blue", prospect: "purple", client: "green", churned: "red", unqualified: "gray" };

/** Tag list with add/remove. */
export function TagEditor({ tags, onSave, suggestions = [] }: { tags: string[]; onSave: (tags: string[]) => Promise<unknown> | void; suggestions?: string[] }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const add = (t: string) => {
    const v = t.trim();
    if (!v || tags.includes(v)) return;
    onSave([...tags, v]);
    setQ("");
    setOpen(false);
  };
  const sugg = suggestions.filter((s) => !tags.includes(s) && s.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-1 py-0.5">
      {tags.map((t) => (
        <Tag key={t} color="blue" className="group pr-0.5">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onSave(tags.filter((x) => x !== t))} className="rounded-sm opacity-60 hover:opacity-100 cursor-pointer">
            <X className="size-3" />
          </button>
        </Tag>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-5 items-center gap-0.5 rounded-sm px-1 text-xs text-fg-3 hover:bg-hover cursor-pointer">
            <Plus className="size-3" /> Tag
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-1">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(q)}
            placeholder="Type a tag, press Enter" className="h-8 w-full rounded-md border border-border bg-bg px-2 text-[13px] outline-none focus:border-accent" />
          {sugg.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="mt-0.5 flex h-7 w-full items-center rounded-md px-2 text-[13px] hover:bg-hover cursor-pointer">{s}</button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
