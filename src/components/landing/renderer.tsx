import ReactMarkdown from "react-markdown";
import type { LandingPage, LandingSection } from "@/lib/types";
import { LeadForm, CtaButton } from "./interactive";

export interface LandingTheme { accent: string; font: string; mode: "light" | "dark" }

export function palette(mode: "light" | "dark") {
  return mode === "dark"
    ? { bg: "#0b0b0f", alt: "#131318", card: "#17171d", text: "#f5f5f7", muted: "#a1a1aa", border: "#26262e" }
    : { bg: "#ffffff", alt: "#f7f7f9", card: "#ffffff", text: "#0b0b0f", muted: "#5b5b66", border: "#e7e7ec" };
}

export type RenderPage = Pick<LandingPage, "id" | "name" | "theme" | "after_submit" | "success_message" | "redirect_url" | "calendly_url">;

export interface RendererProps {
  page: RenderPage;
  variantId: string | null;
  sections: LandingSection[];
  /** Calendly URL resolved from page or workspace default. */
  calendlyUrl?: string | null;
  /** Editor preview: disables submissions/tracking. */
  preview?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

function embedUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
    if (u.hostname === "youtu.be") return `https://www.youtube.com/embed${u.pathname}`;
    if (u.hostname.includes("vimeo.com") && !u.hostname.startsWith("player")) return `https://player.vimeo.com/video${u.pathname}`;
    if (u.hostname.includes("loom.com")) return url.replace("/share/", "/embed/");
    return url;
  } catch {
    return url;
  }
}

/** Renders a landing page variant. Works as a server component (public page) and inside the client editor. */
export function LandingRenderer({ page, variantId, sections, calendlyUrl, preview, selectedId, onSelect }: RendererProps) {
  const theme: LandingTheme = { ...({ accent: "#1961ED", font: "Inter", mode: "light" } as LandingTheme), ...(page.theme ?? {}) };
  const c = palette(theme.mode);
  const accent = theme.accent || "#1961ED";
  const hasForm = sections.some((s) => s.type === "form");
  const ctaTarget = hasForm ? "#lp-form" : calendlyUrl || "#";
  let altIdx = 0;

  return (
    <div style={{ background: c.bg, color: c.text, fontFamily: `${theme.font || "Inter"}, Inter, ui-sans-serif, system-ui, sans-serif` }} className="min-h-full text-base leading-relaxed">
      {sections.length === 0 && (
        <div className="px-6 py-32 text-center" style={{ color: c.muted }}>This variant has no sections yet.</div>
      )}
      {sections.map((s) => {
        const alt = s.type !== "hero" && altIdx++ % 2 === 1;
        const wrapStyle: React.CSSProperties = { background: alt ? c.alt : c.bg };
        const selectable = !!onSelect;
        const isSel = selectedId === s.id;
        return (
          <section
            key={s.id}
            id={s.type === "form" ? "lp-form" : undefined}
            style={{ ...wrapStyle, outline: isSel ? `2px solid ${accent}` : undefined, outlineOffset: -2 }}
            onClick={selectable ? (e) => { e.preventDefault(); onSelect?.(s.id); } : undefined}
            className={selectable ? "relative cursor-pointer transition-[outline] hover:outline hover:outline-2 hover:outline-offset-[-2px] hover:outline-[#1961ED66]" : "relative"}
          >
            <Section s={s} c={c} accent={accent} ctaTarget={ctaTarget} page={page} variantId={variantId} calendlyUrl={calendlyUrl} preview={preview} />
          </section>
        );
      })}
      <footer className="px-6 py-10 text-center text-sm" style={{ color: c.muted, borderTop: `1px solid ${c.border}` }}>
        © {new Date().getFullYear()} {page.name.split("–")[0].trim() || "Ravenshaw AI"}. All rights reserved.
      </footer>
    </div>
  );
}

type Pal = ReturnType<typeof palette>;

function Section({ s, c, accent, ctaTarget, page, variantId, calendlyUrl, preview }: {
  s: LandingSection; c: Pal; accent: string; ctaTarget: string; page: RenderPage; variantId: string | null; calendlyUrl?: string | null; preview?: boolean;
}) {
  const container = "mx-auto w-full max-w-5xl px-6";
  switch (s.type) {
    case "hero": {
      const center = s.align !== "left";
      return (
        <div className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(60% 60% at ${center ? "50%" : "20%"} 0%, ${accent}22 0%, transparent 70%)` }} />
          <div className={`${container} relative py-20 md:py-28 ${center ? "text-center" : ""}`}>
            <div className={center ? "mx-auto max-w-3xl" : "max-w-2xl"}>
              <h1 className="text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">{s.headline}</h1>
              {s.subheadline && <p className="mt-5 text-lg md:text-xl" style={{ color: c.muted }}>{s.subheadline}</p>}
              {s.cta && (
                <div className={`mt-8 flex ${center ? "justify-center" : ""}`}>
                  <CtaButton href={ctaTarget} accent={accent} pageId={page.id} variantId={variantId} preview={preview} label={s.cta} size="lg" />
                </div>
              )}
            </div>
            {s.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.image} alt="" className="mx-auto mt-14 w-full max-w-4xl rounded-2xl shadow-2xl" style={{ border: `1px solid ${c.border}` }} />
            )}
          </div>
        </div>
      );
    }
    case "features":
      return (
        <div className={`${container} py-20`}>
          {s.heading && <h2 className="mb-12 text-center text-3xl font-bold tracking-tight md:text-4xl">{s.heading}</h2>}
          <div className="grid gap-5 md:grid-cols-3">
            {s.items.map((f, i) => (
              <div key={i} className="rounded-2xl p-6" style={{ background: c.card, border: `1px solid ${c.border}` }}>
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl text-lg font-bold" style={{ background: `${accent}18`, color: accent }}>
                  {f.icon || i + 1}
                </div>
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-[15px]" style={{ color: c.muted }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      );
    case "social_proof":
      return (
        <div className={`${container} py-20`}>
          {s.heading && <h2 className="mb-10 text-center text-3xl font-bold tracking-tight md:text-4xl">{s.heading}</h2>}
          {!!s.logos?.length && (
            <div className="mb-12 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 opacity-70">
              {s.logos.map((l, i) =>
                /^https?:/.test(l)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img key={i} src={l} alt="" className="h-7 w-auto grayscale" />
                  : <span key={i} className="text-lg font-semibold" style={{ color: c.muted }}>{l}</span>,
              )}
            </div>
          )}
          <div className="grid gap-5 md:grid-cols-2">
            {(s.testimonials ?? []).map((t, i) => (
              <figure key={i} className="rounded-2xl p-6" style={{ background: c.card, border: `1px solid ${c.border}` }}>
                <div className="mb-3 text-sm" style={{ color: accent }}>★★★★★</div>
                <blockquote className="text-[17px] leading-relaxed">“{t.quote}”</blockquote>
                <figcaption className="mt-4 text-sm">
                  <span className="font-semibold">{t.name}</span>
                  {t.role && <span style={{ color: c.muted }}> · {t.role}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      );
    case "stats":
      return (
        <div className={`${container} py-14`}>
          <div className="grid gap-6 text-center sm:grid-cols-3">
            {s.items.map((st, i) => (
              <div key={i}>
                <div className="text-4xl font-bold tracking-tight md:text-5xl" style={{ color: accent }}>{st.value}</div>
                <div className="mt-1 text-sm" style={{ color: c.muted }}>{st.label}</div>
              </div>
            ))}
          </div>
        </div>
      );
    case "faq":
      return (
        <div className="mx-auto w-full max-w-3xl px-6 py-20">
          {s.heading && <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">{s.heading}</h2>}
          <div className="divide-y" style={{ borderColor: c.border }}>
            {s.items.map((f, i) => (
              <details key={i} className="group py-4" style={{ borderColor: c.border }} open={i === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between text-[17px] font-medium">
                  {f.q}
                  <span className="ml-4 transition-transform group-open:rotate-45" style={{ color: accent }}>+</span>
                </summary>
                <p className="mt-3 text-[15px]" style={{ color: c.muted }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      );
    case "form":
      return (
        <div className="mx-auto w-full max-w-xl px-6 py-20">
          <div className="rounded-2xl p-6 shadow-xl md:p-8" style={{ background: c.card, border: `1px solid ${c.border}` }}>
            {s.heading && <h2 className="text-2xl font-bold tracking-tight">{s.heading}</h2>}
            {s.subheading && <p className="mt-2 text-[15px]" style={{ color: c.muted }}>{s.subheading}</p>}
            <LeadForm
              fields={s.fields}
              button={s.button || "Submit"}
              accent={accent}
              colors={c}
              pageId={page.id}
              variantId={variantId}
              afterSubmit={page.after_submit}
              successMessage={page.success_message}
              redirectUrl={page.redirect_url}
              calendlyUrl={calendlyUrl ?? null}
              preview={preview}
            />
          </div>
        </div>
      );
    case "cta":
      return (
        <div className={`${container} py-20`}>
          <div className="rounded-3xl px-6 py-14 text-center text-white md:px-12" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{s.headline}</h2>
            {s.body && <p className="mx-auto mt-3 max-w-xl text-lg text-white/85">{s.body}</p>}
            {s.button && (
              <div className="mt-8 flex justify-center">
                <CtaButton href={ctaTarget} accent="#ffffff" textColor={accent} pageId={page.id} variantId={variantId} preview={preview} label={s.button} size="lg" />
              </div>
            )}
          </div>
        </div>
      );
    case "video":
      return (
        <div className="mx-auto w-full max-w-4xl px-6 py-20">
          {s.heading && <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">{s.heading}</h2>}
          <div className="aspect-video overflow-hidden rounded-2xl shadow-xl" style={{ border: `1px solid ${c.border}` }}>
            {s.url ? (
              <iframe src={embedUrl(s.url)} className="size-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title={s.heading || "Video"} />
            ) : (
              <div className="flex size-full items-center justify-center" style={{ color: c.muted }}>Add a video URL</div>
            )}
          </div>
        </div>
      );
    case "rich_text":
      return (
        <div className="mx-auto w-full max-w-3xl px-6 py-16 [&_a]:underline [&_h1]:mb-4 [&_h1]:text-4xl [&_h1]:font-bold [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-3xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-xl [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-6 text-[17px]">
          <ReactMarkdown>{s.markdown}</ReactMarkdown>
        </div>
      );
  }
}
