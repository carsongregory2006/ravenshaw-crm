import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listProjects } from "@/lib/projects";
import { ProjectsView } from "./projects-view";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const projects = await listProjects(await createClient());
  return <ProjectsView projects={projects} openId={sp.p ?? null} />;
}
