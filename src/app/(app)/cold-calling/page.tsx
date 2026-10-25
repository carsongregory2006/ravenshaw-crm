import type { Metadata } from "next";
import { ColdCallingDashboard } from "./dashboard";

export const metadata: Metadata = { title: "Cold Calling" };

export default function ColdCallingPage() {
  return <ColdCallingDashboard />;
}
