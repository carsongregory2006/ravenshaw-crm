import { appUrl } from "@/lib/utils";

/**
 * Lander tracker. Paste on any page you built elsewhere:
 *   <script async src="https://<crm>/api/public/t?p=<page id>"></script>
 * Records one visit per page load: time on page, scroll depth, CTA clicks, form submits, Calendly bookings,
 * and VSL watch time for HTML5 <video>, YouTube, Vimeo and Wistia players. Add data-variant="B" to the
 * script tag (or ?variant=B to the URL) to split results by variant.
 */
const SCRIPT = (endpoint: string) => `(function () {
  var me = document.currentScript; if (!me) return;
  var page = new URL(me.src).searchParams.get("p"); if (!page || window.__rsLander) return; window.__rsLander = 1;
  var q = new URLSearchParams(location.search);
  function rid() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)); }
  var vid; try { vid = localStorage.getItem("rs_vid"); if (!vid) { vid = rid(); localStorage.setItem("rs_vid", vid); } } catch (e) { vid = rid(); }
  var utm = {}; ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(function (k) { if (q.get(k)) utm[k] = q.get(k).slice(0, 300); });
  var w = Math.min(screen.width, innerWidth);
  var s = {
    visit_id: rid(), page_id: page, visitor_id: vid,
    variant: me.getAttribute("data-variant") || q.get("variant") || q.get("v") || null,
    time_on_page_s: 0, max_scroll_pct: 0, cta_clicks: 0,
    vsl_started: false, vsl_watch_s: 0, vsl_duration_s: 0, vsl_max_pct: 0,
    converted: false, booked: false,
    referrer: document.referrer || null, utm: utm,
    device: w < 768 ? "mobile" : w < 1100 && "ontouchstart" in window ? "tablet" : "desktop"
  };
  var watch = 0, last = -1;
  function send() {
    var p = JSON.parse(JSON.stringify(s)); p.vsl_watch_s = Math.round(watch);
    var body = JSON.stringify(p);
    try { if (navigator.sendBeacon && navigator.sendBeacon(${JSON.stringify(endpoint)}, new Blob([body], { type: "text/plain" }))) return; } catch (e) {}
    try { fetch(${JSON.stringify(endpoint)}, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } }); } catch (e) {}
  }
  setInterval(function () { if (document.visibilityState === "visible") s.time_on_page_s++; }, 1000);
  setTimeout(send, 3000);
  setInterval(function () { if (document.visibilityState === "visible") send(); }, 15000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") send(); });
  addEventListener("pagehide", send);
  addEventListener("scroll", function () {
    var h = document.documentElement.scrollHeight - innerHeight;
    var pct = h > 0 ? Math.round(Math.min(1, scrollY / h) * 100) : 100;
    if (pct > s.max_scroll_pct) s.max_scroll_pct = pct;
  }, { passive: true });
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("a,button,[data-rs-cta],input[type=submit]");
    if (t) { s.cta_clicks++; send(); }
  }, true);
  document.addEventListener("submit", function () { s.converted = true; send(); }, true);
  addEventListener("message", function (e) {
    var d = e.data;
    if (typeof d === "string") { try { d = JSON.parse(d); } catch (x) { return; } }
    if (!d || typeof d !== "object") return;
    if (d.event === "calendly.event_scheduled") { s.booked = true; s.converted = true; send(); return; }
    if (/youtube/.test(e.origin) && d.info) {
      if (d.info.duration) yt.duration = d.info.duration;
      if (typeof d.info.currentTime === "number") tick(d.info.currentTime, yt.duration);
      return;
    }
    if (/vimeo/.test(e.origin) && d.event === "timeupdate" && d.data) tick(d.data.seconds, d.data.duration);
    if (/vimeo/.test(e.origin) && d.event === "ready") vimeoListen(e.source);
  });
  window.ravenshaw = { convert: function () { s.converted = true; send(); }, book: function () { s.booked = true; s.converted = true; send(); } };

  /* ── VSL ── */
  var yt = { duration: 0 };
  function tick(cur, dur) {
    if (!(cur >= 0)) return;
    if (dur > 0) s.vsl_duration_s = Math.round(dur);
    if (cur > 0.5) s.vsl_started = true;
    var d = cur - last; if (last >= 0 && d > 0 && d <= 2.5) watch += d; last = cur;
    if (dur > 0) { var pct = Math.min(100, Math.round(cur / dur * 100)); if (pct > s.vsl_max_pct) s.vsl_max_pct = pct; }
  }
  function vimeoListen(win) { ["timeupdate", "play"].forEach(function (ev) { win.postMessage(JSON.stringify({ method: "addEventListener", value: ev }), "*"); }); }
  function scan() {
    document.querySelectorAll("video").forEach(function (v) {
      if (v.__rs) return; v.__rs = 1;
      v.addEventListener("timeupdate", function () { tick(v.currentTime, v.duration); });
    });
    document.querySelectorAll("iframe").forEach(function (f) {
      if (f.__rs || !f.src) return;
      if (/youtube(-nocookie)?\\.com\\/embed/.test(f.src)) {
        f.__rs = 1;
        if (!/enablejsapi=1/.test(f.src)) f.src += (f.src.indexOf("?") < 0 ? "?" : "&") + "enablejsapi=1";
        var n = 0, hello = setInterval(function () {
          if (++n > 30) return clearInterval(hello);
          try { f.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"); } catch (x) {}
        }, 1000);
      } else if (/player\\.vimeo\\.com/.test(f.src)) {
        f.__rs = 1;
        f.addEventListener("load", function () { vimeoListen(f.contentWindow); });
        try { vimeoListen(f.contentWindow); } catch (x) {}
      }
    });
  }
  window._wq = window._wq || [];
  window._wq.push({ id: "_all", onReady: function (v) { v.bind("secondchange", function (sec) { tick(sec, v.duration()); }); } });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
  setInterval(scan, 2000);
})();`;

export function GET() {
  return new Response(SCRIPT(`${appUrl()}/api/public/visit`), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
