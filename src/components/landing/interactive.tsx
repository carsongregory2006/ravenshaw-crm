"use client";
import { useEffect, useState } from "react";
import { FORM_FIELD_LABELS } from "./templates";

/* ───────── visitor / utm helpers ───────── */

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(name: string, value: string, days = 180) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${days * 86400}; samesite=lax`;
}

export function visitorId() {
  let v = getCookie("rs_vid");
  if (!v) {
    v = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    setCookie("rs_vid", v, 365);
  }
  return v;
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

/** UTMs from the URL, persisted per session so they survive in-page navigation. */
export function captureUtm(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const qs = new URLSearchParams(window.location.search);
  const fromUrl: Record<string, string> = {};
  UTM_KEYS.forEach((k) => { const v = qs.get(k); if (v) fromUrl[k] = v; });
  try {
    if (Object.keys(fromUrl).length) sessionStorage.setItem("rs_utm", JSON.stringify(fromUrl));
    else return JSON.parse(sessionStorage.getItem("rs_utm") || "{}");
  } catch {}
  return fromUrl;
}

export function track(body: { page_id: string; variant_id: string | null; type: "view" | "cta_click" | "booking"; contact_id?: string }) {
  const payload = JSON.stringify({ ...body, visitor_id: visitorId(), referrer: document.referrer || null, utm: captureUtm() });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/public/event", new Blob([payload], { type: "application/json" }));
      return;
    }
  } catch {}
  fetch("/api/public/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
}

/* ───────── view tracker (mounted on the public page) ───────── */

export function PageTracker({ pageId, variantId }: { pageId: string; variantId: string | null }) {
  useEffect(() => {
    visitorId();
    if (variantId) setCookie(`rs_v_${pageId}`, variantId, 90);
    const key = `rs_viewed_${pageId}_${variantId}`;
    // one view per tab session, so refreshes don't inflate traffic
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {}
    track({ page_id: pageId, variant_id: variantId, type: "view" });
  }, [pageId, variantId]);
  return null;
}

/* ───────── CTA button ───────── */

export function CtaButton({ href, label, accent, textColor = "#fff", pageId, variantId, preview, size = "md" }: {
  href: string; label: string; accent: string; textColor?: string; pageId: string; variantId: string | null; preview?: boolean; size?: "md" | "lg";
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (preview) { e.preventDefault(); return; }
        track({ page_id: pageId, variant_id: variantId, type: "cta_click" });
        if (href.startsWith("#")) {
          e.preventDefault();
          document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }}
      style={{ background: accent, color: textColor }}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl ${size === "lg" ? "h-14 px-8 text-[17px]" : "h-11 px-6 text-[15px]"}`}
    >
      {label} <span aria-hidden>→</span>
    </a>
  );
}

/* ───────── Lead form ───────── */

type Colors = { bg: string; alt: string; card: string; text: string; muted: string; border: string };

export function LeadForm({
  fields, button, accent, colors: c, pageId, variantId, afterSubmit, successMessage, redirectUrl, calendlyUrl, preview,
}: {
  fields: string[]; button: string; accent: string; colors: Colors; pageId: string; variantId: string | null;
  afterSubmit: "message" | "redirect" | "calendly"; successMessage: string | null; redirectUrl: string | null; calendlyUrl: string | null; preview?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [calendlySrc, setCalendlySrc] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);

  // Calendly inline widget posts a message when a meeting is scheduled → record a booking event
  useEffect(() => {
    if (!calendlySrc) return;
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data === "object" && e.data?.event === "calendly.event_scheduled") {
        track({ page_id: pageId, variant_id: variantId, type: "booking", contact_id: contactId ?? undefined });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [calendlySrc, pageId, variantId, contactId]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (preview) { setStatus("done"); return; }
    setStatus("sending");
    setError(null);
    const hp = (e.currentTarget.elements.namedItem("company_url_hp") as HTMLInputElement | null)?.value;
    try {
      const res = await fetch("/api/public/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values, page_id: pageId, variant_id: variantId, visitor_id: visitorId(),
          utm: captureUtm(), referrer: document.referrer || null, hp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setContactId(data.contact_id ?? null);
      if (afterSubmit === "redirect" && redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
      if (afterSubmit === "calendly" && calendlyUrl) {
        const u = new URL(calendlyUrl);
        const name = [values.first_name, values.last_name].filter(Boolean).join(" ");
        if (name) u.searchParams.set("name", name);
        if (values.email) u.searchParams.set("email", values.email);
        if (values.phone) u.searchParams.set("a1", values.phone);
        if (data.contact_id) u.searchParams.set("utm_content", data.contact_id);
        u.searchParams.set("utm_source", "landing_page");
        u.searchParams.set("utm_campaign", pageId);
        u.searchParams.set("embed_domain", window.location.host);
        u.searchParams.set("embed_type", "Inline");
        u.searchParams.set("hide_gdpr_banner", "1");
        setCalendlySrc(u.toString());
      }
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  };

  if (status === "done") {
    if (calendlySrc) {
      return (
        <div className="mt-6">
          <p className="mb-3 text-[15px] font-medium">Great — now pick a time that works for you:</p>
          <iframe src={calendlySrc} title="Schedule a call" className="h-[700px] w-full rounded-xl" style={{ border: `1px solid ${c.border}` }} />
        </div>
      );
    }
    return (
      <div className="mt-6 rounded-xl p-5 text-center" style={{ background: `${accent}12`, color: c.text }}>
        <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full text-lg text-white" style={{ background: accent }}>✓</div>
        <p className="text-[15px] font-medium">{preview ? "Preview: form submissions are disabled in the editor." : successMessage || "Thanks! We'll be in touch shortly."}</p>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = { background: c.bg, color: c.text, border: `1px solid ${c.border}` };
  const half = new Set(["first_name", "last_name"]);
  return (
    <form onSubmit={submit} className="mt-6 grid grid-cols-2 gap-3">
      {fields.map((f) => {
        const common = {
          name: f,
          value: values[f] ?? "",
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [f]: e.target.value })),
          placeholder: FORM_FIELD_LABELS[f] ?? f,
          "aria-label": FORM_FIELD_LABELS[f] ?? f,
          style: inputStyle,
          className: "w-full rounded-xl px-4 text-[15px] outline-none transition focus:ring-2",
        };
        const span = half.has(f) && fields.includes(f === "first_name" ? "last_name" : "first_name") ? "col-span-1" : "col-span-2";
        if (f === "message") return <textarea key={f} {...common} rows={4} className={`${common.className} ${span} py-3`} />;
        return (
          <input key={f} {...common} className={`${common.className} ${span} h-12`}
            type={f === "email" ? "email" : f === "phone" ? "tel" : f === "website" ? "url" : "text"}
            required={f === "email" || (f === "phone" && !fields.includes("email")) || f === "first_name"} />
        );
      })}
      {/* honeypot */}
      <input type="text" name="company_url_hp" tabIndex={-1} autoComplete="off" className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden />
      {error && <p className="col-span-2 text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={status === "sending"} style={{ background: accent }}
        className="col-span-2 mt-1 h-12 rounded-xl text-[16px] font-semibold text-white shadow-lg transition hover:opacity-95 disabled:opacity-60">
        {status === "sending" ? "Sending…" : button}
      </button>
      <p className="col-span-2 text-center text-xs" style={{ color: c.muted }}>
        By submitting you agree to be contacted by phone, SMS and email. Reply STOP to opt out.
      </p>
    </form>
  );
}
