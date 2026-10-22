import { Suspense } from "react";
import type { Metadata } from "next";
import { Inbox } from "./inbox";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  return <Suspense><Inbox /></Suspense>;
}
