import { requireProfile } from "@/lib/auth";
import { TasksPageView } from "./tasks-view";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ new?: string; scope?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  return <TasksPageView openNew={sp.new === "1"} scope={sp.scope === "all" ? "all" : "mine"} />;
}
