"use client";
import * as React from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { cn, contactLabel } from "@/lib/utils";
import { createCompany } from "@/lib/actions/crm";

export interface PickerOption { id: string; label: string; sub?: string | null; avatar?: string | null }

/** Generic searchable single-select popover. `load(q)` returns options. */
export function SearchSelect({
  value, valueLabel, onChange, load, placeholder = "Select…", allowClear = true, onCreate, avatars = true, square, className, disabled,
}: {
  value: string | null | undefined;
  valueLabel?: string | null;
  onChange: (opt: PickerOption | null) => void;
  load: (q: string) => Promise<PickerOption[]>;
  placeholder?: string;
  allowClear?: boolean;
  onCreate?: (q: string) => Promise<PickerOption | null>;
  avatars?: boolean;
  square?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [opts, setOpts] = React.useState<PickerOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await load(q.trim()).catch(() => []);
      if (!cancelled) { setOpts(res); setActive(0); setLoading(false); }
    }, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open, load]);

  const pick = (o: PickerOption | null) => { onChange(o); setOpen(false); setQ(""); };
  const canCreate = !!onCreate && q.trim().length > 0 && !opts.some((o) => o.label.toLowerCase() === q.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled}
          className={cn("flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-left text-[13px] hover:bg-hover disabled:opacity-60 cursor-pointer", className)}>
          {value && valueLabel ? (
            <>
              {avatars && <Avatar name={valueLabel} size={16} square={square} />}
              <span className="truncate">{valueLabel}</span>
            </>
          ) : <span className="truncate text-fg-4">{placeholder}</span>}
          <ChevronDown className="ml-auto size-3.5 shrink-0 text-fg-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0">
        <div className="flex items-center gap-1.5 border-b border-border-light px-2">
          <Search className="size-3.5 text-fg-3" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, opts.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); if (opts[active]) pick(opts[active]); else if (canCreate) onCreate!(q.trim()).then((o) => o && pick(o)); }
            }}
            className="h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-fg-4" />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {allowClear && value && (
            <button type="button" onClick={() => pick(null)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover cursor-pointer">
              <X className="size-3.5" /> Clear
            </button>
          )}
          {loading && opts.length === 0 && <div className="px-2 py-2 text-xs text-fg-3">Searching…</div>}
          {!loading && opts.length === 0 && !canCreate && <div className="px-2 py-2 text-xs text-fg-3">No results</div>}
          {opts.map((o, i) => (
            <button type="button" key={o.id} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
              className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] cursor-pointer", i === active && "bg-hover")}>
              {avatars && <Avatar name={o.label} src={o.avatar} size={16} square={square} />}
              <span className="truncate">{o.label}</span>
              {o.sub && <span className="ml-auto max-w-[45%] truncate text-xs text-fg-3">{o.sub}</span>}
              {o.id === value && <Check className="ml-1 size-3.5 shrink-0 text-accent" />}
            </button>
          ))}
          {canCreate && (
            <button type="button" onClick={async () => { const o = await onCreate!(q.trim()); if (o) pick(o); }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-accent hover:bg-hover cursor-pointer">
              <Plus className="size-3.5" /> Create “{q.trim()}”
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ContactPicker({ value, valueLabel, onChange, placeholder = "Select person", className }: {
  value: string | null | undefined; valueLabel?: string | null; onChange: (id: string | null, opt: PickerOption | null) => void; placeholder?: string; className?: string;
}) {
  const [label, setLabel] = React.useState<string | null>(valueLabel ?? null);
  React.useEffect(() => {
    if (!value) { setLabel(null); return; }
    if (valueLabel) { setLabel(valueLabel); return; }
    createClient().from("contacts").select("first_name,last_name,email,phone").eq("id", value).single()
      .then(({ data }) => data && setLabel(contactLabel(data)));
  }, [value, valueLabel]);
  const load = React.useCallback(async (q: string) => {
    let query = createClient().from("contacts").select("id, first_name, last_name, email, phone").order("created_at", { ascending: false }).limit(20);
    if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
    const { data } = await query;
    return (data ?? []).map((c) => ({ id: c.id, label: contactLabel(c), sub: c.email ?? c.phone }));
  }, []);
  return <SearchSelect value={value} valueLabel={label} load={load} placeholder={placeholder} className={className}
    onChange={(o) => { setLabel(o?.label ?? null); onChange(o?.id ?? null, o); }} />;
}

export function CompanyPicker({ value, valueLabel, onChange, placeholder = "Select company", className, allowCreate = true }: {
  value: string | null | undefined; valueLabel?: string | null; onChange: (id: string | null, opt: PickerOption | null) => void; placeholder?: string; className?: string; allowCreate?: boolean;
}) {
  const [label, setLabel] = React.useState<string | null>(valueLabel ?? null);
  React.useEffect(() => {
    if (!value) { setLabel(null); return; }
    if (valueLabel) { setLabel(valueLabel); return; }
    createClient().from("companies").select("name").eq("id", value).single().then(({ data }) => data && setLabel(data.name));
  }, [value, valueLabel]);
  const load = React.useCallback(async (q: string) => {
    let query = createClient().from("companies").select("id, name, domain").order("name").limit(20);
    if (q) query = query.or(`name.ilike.%${q}%,domain.ilike.%${q}%`);
    const { data } = await query;
    return (data ?? []).map((c) => ({ id: c.id, label: c.name, sub: c.domain }));
  }, []);
  const create = async (name: string) => {
    const r = await createCompany({ name });
    if (!r.ok) { toast.error(r.error); return null; }
    toast.success(`Company “${name}” created`);
    return { id: r.data.id, label: r.data.name };
  };
  return <SearchSelect value={value} valueLabel={label} load={load} placeholder={placeholder} className={className} square
    onCreate={allowCreate ? create : undefined}
    onChange={(o) => { setLabel(o?.label ?? null); onChange(o?.id ?? null, o); }} />;
}

export interface UserOption { id: string; full_name: string | null; email: string; avatar_url?: string | null; role?: string }

let usersCache: Promise<UserOption[]> | null = null;
export function loadUsers(): Promise<UserOption[]> {
  if (!usersCache) {
    usersCache = Promise.resolve(createClient().from("profiles").select("id, full_name, email, avatar_url, role").eq("is_active", true).order("full_name"))
      .then(({ data }) => (data as UserOption[]) ?? []);
  }
  return usersCache;
}

export function UserPicker({ value, onChange, users, placeholder = "Unassigned", className, disabled }: {
  value: string | null | undefined; onChange: (id: string | null) => void; users?: UserOption[]; placeholder?: string; className?: string; disabled?: boolean;
}) {
  const [list, setList] = React.useState<UserOption[]>(users ?? []);
  React.useEffect(() => { if (!users) loadUsers().then(setList); else setList(users); }, [users]);
  const selected = list.find((u) => u.id === value);
  const load = React.useCallback(async (q: string) => {
    const src = users ?? (await loadUsers());
    return src
      .filter((u) => !q || (u.full_name ?? "").toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()))
      .map((u) => ({ id: u.id, label: u.full_name || u.email, sub: u.role?.replace("_", " "), avatar: u.avatar_url }));
  }, [users]);
  return <SearchSelect value={value} valueLabel={selected ? selected.full_name || selected.email : null} load={load}
    placeholder={placeholder} className={className} disabled={disabled} onChange={(o) => onChange(o?.id ?? null)} />;
}
