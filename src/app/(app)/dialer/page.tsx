import type { Metadata } from "next";
import { DialerHome } from "./dialer-home";

export const metadata: Metadata = { title: "Power Dialer" };

export default function DialerPage() {
  return <DialerHome />;
}
