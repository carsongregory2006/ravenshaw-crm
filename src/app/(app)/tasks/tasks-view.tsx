"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckSquare } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { TasksList } from "@/components/records/tasks-list";

export function TasksPageView({ openNew, scope }: { openNew: boolean; scope: "mine" | "all" }) {
  const router = useRouter();
  React.useEffect(() => { if (openNew) router.replace("/tasks"); }, [openNew, router]);
  return (
    <Page>
      <PageHeader icon={CheckSquare} title="Tasks" />
      <PageBody>
        <div className="mx-auto max-w-4xl">
          <TasksList scope={scope} showScopeToggle autoOpenNew={openNew} />
        </div>
      </PageBody>
    </Page>
  );
}
