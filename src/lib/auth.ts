import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Signed-in user's profile even if the account is still awaiting approval. Only the app layout needs this. */
export const getProfileIncludingInactive = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (data as Profile) ?? null;
});

/** Current user's profile, or null. Accounts awaiting approval count as signed out. Cached per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const p = await getProfileIncludingInactive();
  return p?.is_active ? p : null;
});

export async function requireProfile(): Promise<Profile> {
  const p = await getProfile();
  if (!p) redirect("/login");
  return p;
}

export async function requireStaff(): Promise<Profile> {
  const p = await requireProfile();
  if (p.role !== "admin" && p.role !== "ops") redirect("/dashboard?denied=1");
  return p;
}

export async function requireAdmin(): Promise<Profile> {
  const p = await requireProfile();
  if (p.role !== "admin") redirect("/dashboard?denied=1");
  return p;
}

export const isStaff = (p: Pick<Profile, "role">) => p.role === "admin" || p.role === "ops";
