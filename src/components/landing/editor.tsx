"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft, BarChart3, Check, Code2, Copy, ExternalLink, Eye, EyeOff, Flag, GripVertical, Laptop, LayoutTemplate,
  MoreHorizontal, Pencil, Plus, Save, Settings2, Smartphone, Sparkles, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field, Switch, Textarea } from "@/components/ui/input";
import { StatusTag, Tag } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { EmptyState, SectionTitle } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LandingPage, LandingPageVariant, LandingSection, RrMember } from "@/lib/types";
import {
  createVariant, deleteVariant, generateVariantCopy, saveVariant, setLandingStatus, updateLandingPage,
} from "@/lib/actions/landing";
import { LandingRenderer } from "./renderer";
import { SectionEditor, sectionSummary } from "./section-editor";
import { SettingsPanel, type RepLite } from "./settings-panel";
import { LandingAnalyticsView } from "./analytics";
import { EmbedDialog } from "./embed-dialog";
import { SECTION_LABELS, newSection, uid, type SectionType } from "./templates";

type SaveState = "saved" | "dirty" | "saving" | "error";

/* ───────── iframe preview so responsive breakpoints match the device width ───────── */

function PreviewFrame({ width, children }: { width: number | "100%"; children: React.ReactNode }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const iframe = ref.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write("<!doctype html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head><body style='margin:0'><div id='root'></div></body></html>");
    doc.close();
    const copyStyles = () => {
      doc.head.querySelectorAll("[data-copied]").forEach((n) => n.remove());
      document.querySelectorAll("style, link[rel='stylesheet']").forEach((n) => {
        const c = n.cloneNode(true) as HTMLElement;
        c.setAttribute("data-copied", "1");
        doc.head.appendChild(c);
      });
    };
    copyStyles();
    doc.body.className = document.body.className;
    doc.body.style.fontSize = "16px";
    setMount(doc.getElementById("root"));
    // keep styles in sync (dev HMR / lazily loaded CSS)
    const obs = new MutationObserver(copyStyles);
    obs.observe(document.head, { childList: true });
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <iframe ref={ref} title="Preview" style={{ width }} className="mx-auto h-full rounded-md border border-border bg-white shadow-md transition-[width]" />
      {mount && createPortal(children, mount)}
    </>
  );
}

/* ───────── sortable section row ───────── */

function SectionRow({ s, selected, onSelect, onDuplicate, onDelete }: {
  s: LandingSection; selected: boolean; onSelect: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group flex h-9 items-center gap-1 rounded-md pr-1 text-[13px]", selected ? "bg-active" : "hover:bg-hover", isDragging && "z-10 bg-bg shadow-md")}>
      <button {...attributes} {...listeners} className="cursor-grab px-1 text-fg-4 hover:text-fg-2 active:cursor-grabbing" aria-label="Drag to reorder">
        <GripVertical className="size-3.5" />
      </button>
      <button onClick={onSelect} className="flex min-w-0 flex-1 flex-col items-start text-left cursor-pointer">
        <span className="text-xs font-medium">{SECTION_LABELS[s.type]}</span>
        <span className="w-full truncate text-[11px] text-fg-3">{sectionSummary(s) || "—"}</span>
      </button>
      <div className="hidden gap-0.5 group-hover:flex">
        <Button size="xs" variant="ghost" icon={Copy} onClick={onDuplicate} aria-label="Duplicate section" />
        <Button size="xs" variant="ghost" icon={Trash2} onClick={onDelete} aria-label="Delete section" />
      </div>
    </div>
  );
}

/* ───────── editor ───────── */

export function LandingEditor({ initialPage, initialVariants, initialMembers, reps, defaultCalendly }: {
  initialPage: LandingPage; initialVariants: LandingPageVariant[]; initialMembers: RrMember[]; reps: RepLite[]; defaultCalendly: string | null;
}) {
  const router = useRouter();
  const [page, setPage] = useState(initialPage);
  const [variants, setVariants] = useState(initialVariants);
  const [members, setMembers] = useState(initialMembers);
  const [activeId, setActiveId] = useState(initialVariants.find((v) => v.is_control)?.id ?? initialVariants[0]?.id ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"editor" | "analytics">("editor");
  const [rightTab, setRightTab] = useState<"section" | "page">("section");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [aiOpen, setAiOpen] = useState(false);
  const [angle, setAngle] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<LandingPageVariant | null>(null);

  // refs for the autosaver (avoid stale closures)
  const pageRef = useRef(page);
  const variantsRef = useRef(variants);
  const dirtyPage = useRef(false);
  const dirtyVariants = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  pageRef.current = page;
  variantsRef.current = variants;

  const active = variants.find((v) => v.id === activeId) ?? variants[0];
  const section = active?.sections.find((s) => s.id === selected) ?? null;
  const activeWeight = variants.filter((v) => v.is_active).reduce((a, v) => a + Math.max(0, v.weight), 0);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (saving.current) await saving.current;
    if (!dirtyPage.current && dirtyVariants.current.size === 0) { setSaveState("saved"); return true; }
    const run = (async () => {
      setSaveState("saving");
      let ok = true;
      if (dirtyPage.current) {
        dirtyPage.current = false;
        const p = pageRef.current;
        const r = await updateLandingPage(p.id, {
          name: p.name, slug: p.slug, seo_title: p.seo_title, seo_description: p.seo_description, rr_enabled: p.rr_enabled, rr_mode: p.rr_mode,
          default_owner_id: p.default_owner_id, after_submit: p.after_submit, success_message: p.success_message,
          redirect_url: p.redirect_url || null, calendly_url: p.calendly_url || null, theme: p.theme,
        });
        if (!r.ok) { ok = false; toast.error(r.error); }
        else if (r.data && r.data !== p.slug) setPage((x) => ({ ...x, slug: r.data! }));
      }
      const ids = [...dirtyVariants.current];
      dirtyVariants.current.clear();
      for (const id of ids) {
        const v = variantsRef.current.find((x) => x.id === id);
        if (!v) continue;
        const r = await saveVariant(id, { name: v.name, sections: v.sections, weight: v.weight, is_active: v.is_active });
        if (!r.ok) { ok = false; dirtyVariants.current.add(id); toast.error(r.error); }
      }
      const stillDirty = dirtyPage.current || dirtyVariants.current.size > 0;
      setSaveState(!ok ? "error" : stillDirty ? "dirty" : "saved");
      return ok;
    })();
    saving.current = run;
    const res = await run;
    saving.current = null;
    return res;
  }, []);

  const schedule = useCallback(() => {
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush(); }, 1200);
  }, [flush]);

  // warn on unload with unsaved changes; Cmd/Ctrl+S saves
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirtyPage.current || dirtyVariants.current.size) { e.preventDefault(); }
    };
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); flush().then((ok) => ok && toast.success("Saved")); }
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("beforeunload", before); window.removeEventListener("keydown", key); };
  }, [flush]);

  const updatePage = (patch: Partial<LandingPage>) => {
    setPage((p) => ({ ...p, ...patch }));
    dirtyPage.current = true;
    schedule();
  };
  const updateVariant = (id: string, patch: Partial<LandingPageVariant>) => {
    setVariants((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    dirtyVariants.current.add(id);
    schedule();
  };
  const setSections = (fn: (s: LandingSection[]) => LandingSection[]) => {
    if (!active) return;
    updateVariant(active.id, { sections: fn(active.sections) });
  };

  /* sections */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setSections((ss) => arrayMove(ss, ss.findIndex((s) => s.id === e.active.id), ss.findIndex((s) => s.id === e.over!.id)));
  };
  const addSection = (type: SectionType) => {
    const s = newSection(type);
    setSections((ss) => {
      // keep new content above the footer-ish FAQ/CTA when adding a form? just insert after the selected section
      const idx = ss.findIndex((x) => x.id === selected);
      const next = [...ss];
      next.splice(idx >= 0 ? idx + 1 : ss.length, 0, s);
      return next;
    });
    setSelected(s.id);
    setRightTab("section");
  };

  /* variants */
  const addVariant = async (fromId?: string) => {
    await flush();
    const r = await createVariant(page.id, fromId ?? active?.id);
    if (!r.ok) return toast.error(r.error);
    setVariants((vs) => [...vs, r.data]);
    setActiveId(r.data.id);
    setSelected(null);
    toast.success(`${r.data.name} created — edit its copy to start testing`);
  };
  const removeVariant = async (v: LandingPageVariant) => {
    const r = await deleteVariant(v.id);
    if (!r.ok) return toast.error(r.error);
    dirtyVariants.current.delete(v.id);
    const rest = variants.filter((x) => x.id !== v.id);
    if (v.is_control && rest.length) rest[0] = { ...rest[0], is_control: true };
    setVariants(rest);
    if (activeId === v.id) setActiveId(rest[0]?.id ?? "");
    toast.success("Variant deleted");
  };
  const makeControl = async (v: LandingPageVariant) => {
    const r = await saveVariant(v.id, { is_control: true });
    if (!r.ok) return toast.error(r.error);
    setVariants((vs) => vs.map((x) => ({ ...x, is_control: x.id === v.id })));
  };
  const runAi = async () => {
    if (!active) return;
    setAiBusy(true);
    await flush();
    const r = await generateVariantCopy(page.id, active.id, angle);
    setAiBusy(false);
    if (!r.ok) return toast.error(r.error);
    setVariants((vs) => [...vs, r.data]);
    setActiveId(r.data.id);
    setSelected(null);
    setAiOpen(false);
    setAngle("");
    toast.success(`AI wrote ${r.data.name}. Review it, then publish to start the test.`);
  };

  /* page */
  const togglePublish = async () => {
    const ok = await flush();
    if (!ok) return;
    const next = page.status === "published" ? "draft" : "published";
    const r = await setLandingStatus(page.id, next);
    if (!r.ok) return toast.error(r.error);
    setPage((p) => ({ ...p, status: next }));
    toast.success(next === "published" ? "Page is live" : "Page unpublished");
    router.refresh();
  };
  const copyLink = () => { navigator.clipboard.writeText(`${window.location.origin}/p/${page.slug}`); toast.success("Link copied"); };

  const saveLabel = { saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Save failed" }[saveState];
  const calendlyUrl = page.calendly_url || defaultCalendly;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Link href="/landing-pages" className="rounded-md p-1 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Back"><ArrowLeft className="size-4" /></Link>
        <span className="truncate text-[13px] font-medium">{page.name}</span>
        <StatusTag status={page.status} />
        <button onClick={copyLink} className="hidden items-center gap-1 truncate rounded-sm px-1 text-xs text-fg-3 hover:bg-hover hover:text-fg md:flex cursor-pointer">
          /p/{page.slug} <Copy className="size-3" />
        </button>
        <div className="ml-2 flex rounded-md bg-bg-3 p-0.5">
          {([["editor", LayoutTemplate, "Editor"], ["analytics", BarChart3, "Analytics"]] as const).map(([id, Icon, label]) => (
            <button key={id} onClick={() => { if (id === "analytics") flush(); setView(id); }}
              className={cn("flex h-6 items-center gap-1 rounded-[5px] px-2 text-xs font-medium cursor-pointer", view === id ? "bg-bg text-fg shadow-sm" : "text-fg-3 hover:text-fg")}>
              <Icon className="size-3.5" />{label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className={cn("hidden items-center gap-1 text-xs sm:flex", saveState === "error" ? "text-danger" : "text-fg-3")}>
            {saveState === "saved" && <Check className="size-3.5" />}{saveLabel}
          </span>
          <Button icon={Save} onClick={() => flush().then((ok) => ok && toast.success("Saved"))} disabled={saveState === "saved"}>Save</Button>
          <Button icon={Code2} onClick={() => setEmbedOpen(true)}>Share</Button>
          {page.status === "published" ? (
            <a href={`/p/${page.slug}${active ? `?variant=${active.id}` : ""}`} target="_blank" rel="noreferrer">
              <Button icon={ExternalLink}>View live</Button>
            </a>
          ) : (
            <Tooltip content="Publish the page to view it live"><span><Button icon={ExternalLink} disabled>View live</Button></span></Tooltip>
          )}
          <Button variant={page.status === "published" ? "secondary" : "primary"} icon={page.status === "published" ? EyeOff : Eye} onClick={togglePublish}>
            {page.status === "published" ? "Unpublish" : "Publish"}
          </Button>
        </div>
      </header>

      {view === "analytics" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <LandingAnalyticsView pageId={page.id} onWinner={(id) => setVariants((vs) => vs.map((v) => (v.id === id ? { ...v, is_active: true, weight: 100, is_control: true } : { ...v, is_active: false, weight: 0, is_control: false })))} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* left: variants + sections */}
          <aside className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-r border-border p-2">
            <SectionTitle actions={
              <div className="flex gap-0.5">
                <Tooltip content="Write a new variant with AI"><Button size="xs" variant="ghost" icon={Sparkles} onClick={() => setAiOpen(true)} aria-label="AI variant" /></Tooltip>
                <Tooltip content="New variant (copy of selected)"><Button size="xs" variant="ghost" icon={Plus} onClick={() => addVariant()} aria-label="Add variant" /></Tooltip>
              </div>
            }>Variants · split test</SectionTitle>
            <div className="space-y-1">
              {variants.map((v) => {
                const share = v.is_active && activeWeight ? v.weight / activeWeight : 0;
                return (
                  <div key={v.id} onClick={() => { setActiveId(v.id); setSelected(null); }}
                    className={cn("cursor-pointer rounded-md border p-2", v.id === active?.id ? "border-accent bg-accent-soft/40" : "border-border-light hover:bg-hover")}>
                    <div className="flex items-center gap-1.5">
                      {renaming === v.id ? (
                        <Input autoFocus defaultValue={v.name} className="h-6" onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => { updateVariant(v.id, { name: e.target.value.trim() || v.name }); setRenaming(null); }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }} />
                      ) : (
                        <span className="truncate text-[13px] font-medium" onDoubleClick={() => setRenaming(v.id)}>{v.name}</span>
                      )}
                      {v.is_control && <Tag color="gray" className="h-4 text-[10px]">Control</Tag>}
                      <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
                        <Menu>
                          <MenuTrigger asChild><Button size="xs" variant="ghost" icon={MoreHorizontal} aria-label="Variant actions" /></MenuTrigger>
                          <MenuContent align="end">
                            <MenuItem icon={Pencil} onSelect={() => setRenaming(v.id)}>Rename</MenuItem>
                            <MenuItem icon={Copy} onSelect={() => addVariant(v.id)}>Duplicate</MenuItem>
                            <MenuItem icon={Flag} disabled={v.is_control} onSelect={() => makeControl(v)}>Set as control</MenuItem>
                            <MenuItem icon={Sparkles} onSelect={() => { setActiveId(v.id); setAiOpen(true); }}>AI rewrite as new variant</MenuItem>
                            <MenuSeparator />
                            <MenuItem icon={Trash2} danger disabled={variants.length <= 1} onSelect={() => setConfirmDel(v)}>Delete</MenuItem>
                          </MenuContent>
                        </Menu>
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Switch checked={v.is_active} onChange={(on) => updateVariant(v.id, { is_active: on })} />
                      <input type="range" min={0} max={100} value={v.weight} disabled={!v.is_active} aria-label="Traffic weight"
                        onChange={(e) => updateVariant(v.id, { weight: Number(e.target.value) })} className="h-1 min-w-0 flex-1 accent-[var(--accent)]" />
                      <span className="w-9 text-right text-xs tabular-nums text-fg-2">{v.is_active ? `${Math.round(share * 100)}%` : "off"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {variants.length > 1 && (
              <Button size="xs" variant="ghost" className="mt-1 self-start" onClick={() => {
                const act = variants.filter((v) => v.is_active);
                const even = Math.floor(100 / Math.max(1, act.length));
                act.forEach((v) => updateVariant(v.id, { weight: even }));
              }}>Split traffic evenly</Button>
            )}

            <div className="mt-4">
              <SectionTitle actions={
                <Menu>
                  <MenuTrigger asChild><Button size="xs" variant="ghost" icon={Plus} aria-label="Add section" /></MenuTrigger>
                  <MenuContent align="end">
                    {(Object.keys(SECTION_LABELS) as SectionType[]).map((t) => <MenuItem key={t} onSelect={() => addSection(t)}>{SECTION_LABELS[t]}</MenuItem>)}
                  </MenuContent>
                </Menu>
              }>Sections · {active?.name}</SectionTitle>
              {active && active.sections.length > 0 ? (
                <DndContext id="lp-sections" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={active.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-px">
                      {active.sections.map((s) => (
                        <SectionRow key={s.id} s={s} selected={selected === s.id}
                          onSelect={() => { setSelected(s.id); setRightTab("section"); }}
                          onDuplicate={() => setSections((ss) => { const i = ss.findIndex((x) => x.id === s.id); const n = [...ss]; n.splice(i + 1, 0, { ...s, id: uid() }); return n; })}
                          onDelete={() => { setSections((ss) => ss.filter((x) => x.id !== s.id)); if (selected === s.id) setSelected(null); }} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <p className="px-1 text-xs text-fg-3">No sections. Use + to add one.</p>
              )}
              {active && !active.sections.some((s) => s.type === "form") && (
                <p className="mt-2 rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning">This variant has no lead form, so it can&apos;t capture leads.</p>
              )}
            </div>
          </aside>

          {/* center: preview */}
          <div className="flex min-w-0 flex-1 flex-col bg-bg-3">
            <div className="flex h-9 shrink-0 items-center justify-center gap-1 border-b border-border bg-bg">
              {([["desktop", Laptop], ["mobile", Smartphone]] as const).map(([d, Icon]) => (
                <button key={d} onClick={() => setDevice(d)} aria-label={d}
                  className={cn("rounded-md p-1.5 cursor-pointer", device === d ? "bg-active text-fg" : "text-fg-3 hover:bg-hover")}><Icon className="size-4" /></button>
              ))}
              <span className="ml-2 text-xs text-fg-3">Previewing <b className="text-fg-2">{active?.name}</b> · click a section to edit</span>
            </div>
            <div className="min-h-0 flex-1 p-3">
              {active ? (
                <PreviewFrame width={device === "mobile" ? 390 : "100%"}>
                  <LandingRenderer page={page} variantId={active.id} sections={active.sections} calendlyUrl={calendlyUrl} preview
                    selectedId={selected} onSelect={(id) => { setSelected(id); setRightTab("section"); }} />
                </PreviewFrame>
              ) : (
                <EmptyState title="No variants" action={<Button icon={Plus} onClick={() => addVariant()}>Add variant</Button>} />
              )}
            </div>
          </div>

          {/* right: properties */}
          <aside className="flex w-[320px] shrink-0 flex-col border-l border-border">
            <Tabs value={rightTab} onChange={(t) => setRightTab(t as "section" | "page")}
              tabs={[{ id: "section", label: "Section", icon: LayoutTemplate }, { id: "page", label: "Page settings", icon: Settings2 }]} />
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {rightTab === "section" ? (
                section ? (
                  <SectionEditor key={section.id} section={section} onChange={(s) => setSections((ss) => ss.map((x) => (x.id === s.id ? s : x)))} />
                ) : (
                  <EmptyState icon={LayoutTemplate} title="Select a section" description="Click a section in the preview or the list to edit its content." className="py-10" />
                )
              ) : (
                <SettingsPanel page={page} onChange={updatePage} members={members} setMembers={setMembers} reps={reps} defaultCalendly={defaultCalendly} />
              )}
            </div>
          </aside>
        </div>
      )}

      <Dialog open={aiOpen} onOpenChange={setAiOpen} title="Generate a variant with AI"
        description={`Rewrites the copy of “${active?.name}” around a new angle and saves it as a new variant. Layout, form and media are kept.`}
        footer={<><Button onClick={() => setAiOpen(false)}>Cancel</Button><Button variant="primary" icon={Sparkles} loading={aiBusy} onClick={runAi}>Generate variant</Button></>}>
        <Field label="Test angle / hypothesis" hint="e.g. “Lead with ROI and a money-back guarantee”, “Speak to dental clinics”, “Urgency: only 3 spots this month”">
          <Textarea autoFocus value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="What should this variant test?" />
        </Field>
        <div className="mt-3 flex flex-wrap gap-1.5 pb-2">
          {["Lead with ROI and hard numbers", "Pain-focused: missed leads cost money", "Risk reversal + guarantee", "Shorter, punchier copy", "Speak to local service businesses"].map((a) => (
            <button key={a} onClick={() => setAngle(a)} className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-2 hover:bg-hover cursor-pointer">{a}</button>
          ))}
        </div>
      </Dialog>

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)} size="sm" title={`Delete ${confirmDel?.name}?`}
        description="Its traffic is redistributed to the remaining active variants. Past views and leads stay in analytics totals."
        footer={<><Button onClick={() => setConfirmDel(null)}>Cancel</Button><Button variant="danger" onClick={() => { const v = confirmDel!; setConfirmDel(null); removeVariant(v); }}>Delete</Button></>} />

      <EmbedDialog open={embedOpen} onOpenChange={setEmbedOpen} slug={page.slug} variants={variants} />
    </div>
  );
}
