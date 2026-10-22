"use client";
// PLACEHOLDER — replaced by the comms module (Telnyx WebRTC dialer).
import { createContext, useContext } from "react";

export interface DialTarget { phone: string; contactId?: string | null; name?: string }
const Ctx = createContext<{ call: (t: DialTarget) => void }>({ call: () => {} });
export function DialerProvider({ children }: { children: React.ReactNode }) {
  return <Ctx.Provider value={{ call: () => {} }}>{children}</Ctx.Provider>;
}
export const useDialer = () => useContext(Ctx);
