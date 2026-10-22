"use client";
import { createContext, useContext } from "react";
import type { Profile } from "@/lib/types";

const Ctx = createContext<Profile | null>(null);
export function ProfileProvider({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  return <Ctx.Provider value={profile}>{children}</Ctx.Provider>;
}
/** Current signed-in user's profile (client components). */
export function useProfile() {
  const p = useContext(Ctx);
  if (!p) throw new Error("useProfile outside AppShell");
  return p;
}
export const useIsStaff = () => { const p = useProfile(); return p.role === "admin" || p.role === "ops"; };
