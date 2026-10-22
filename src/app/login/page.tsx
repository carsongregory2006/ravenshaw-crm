"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [mode, setMode] = useState<"password" | "signup" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const sb = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    try {
      if (mode === "password") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next);
        router.refresh();
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (data.session) { router.push(next); router.refresh(); } else setSent(true);
      } else {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
        if (error) throw error;
        setSent(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-2 px-4">
      <div className="w-full max-w-[340px]">
        <div className="mb-6 flex flex-col items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-fg text-lg font-bold text-bg">R</span>
          <h1 className="text-lg font-semibold">{mode === "signup" ? "Create your account" : "Welcome to Ravenshaw AI"}</h1>
          {params.get("deactivated") && <p className="text-xs text-danger">Your account has been deactivated.</p>}
        </div>
        {sent ? (
          <div className="rounded-lg border border-border bg-bg p-4 text-center text-[13px] text-fg-2">
            <Mail className="mx-auto mb-2 size-5 text-fg-3" />
            Check <b>{email}</b> for a link to continue.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-bg p-4 shadow-sm">
            {mode === "signup" && <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>}
            <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
            {mode !== "magic" && <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>}
            <Button type="submit" variant="primary" size="md" className="w-full" loading={loading}>
              {mode === "password" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a sign-in link"}
            </Button>
            <div className="flex justify-between text-xs text-fg-3">
              <button type="button" className="hover:text-fg cursor-pointer" onClick={() => setMode(mode === "magic" ? "password" : "magic")}>
                {mode === "magic" ? "Use password" : "Use magic link"}
              </button>
              <button type="button" className="hover:text-fg cursor-pointer" onClick={() => setMode(mode === "signup" ? "password" : "signup")}>
                {mode === "signup" ? "Have an account? Sign in" : "Create account"}
              </button>
            </div>
          </form>
        )}
        <p className="mt-4 text-center text-xs text-fg-4">The first account created becomes the workspace admin.</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
