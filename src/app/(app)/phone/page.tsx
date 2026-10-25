import type { Metadata } from "next";
import { PhoneView } from "./phone-view";

export const metadata: Metadata = { title: "Phone" };

export default function PhonePage() {
  return <PhoneView />;
}
