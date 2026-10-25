import type { Metadata } from "next";
import { SessionRunner } from "./session-runner";

export const metadata: Metadata = { title: "Dialing session" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionRunner id={id} />;
}
