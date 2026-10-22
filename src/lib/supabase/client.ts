"use client";
import { createBrowserClient } from "@supabase/ssr";

declare global {
  interface Window {
    __SUPABASE_ENV__?: { url: string; anonKey: string };
  }
}

/**
 * Browser client. The URL/key are inlined at build time when available; otherwise they come from
 * window.__SUPABASE_ENV__, which the root layout injects at request time (so a build made before the
 * env vars existed still works).
 */
export function createClient() {
  const runtime = typeof window !== "undefined" ? window.__SUPABASE_ENV__ : undefined;
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || runtime?.url || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || runtime?.anonKey || "",
  );
}
