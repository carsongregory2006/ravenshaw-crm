"use client";
import { useEffect, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import { Sidebar } from "./sidebar";
import { CommandMenu } from "./command-menu";
import { NotificationsPanel, useNotifications } from "./notifications";
import { ProfileProvider } from "./profile-context";
import { DialerProvider } from "@/components/comms/dialer";
import type { Profile } from "@/lib/types";

export function AppShell({ profile, workspaceName, children }: { profile: Profile; workspaceName: string; children: React.ReactNode }) {
  const [cmd, setCmd] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const notifications = useNotifications(profile.id);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("sidebar-collapsed") === "1"); } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("sidebar-collapsed", c ? "0" : "1"); } catch {}
      return !c;
    });
  };

  return (
    <ProfileProvider profile={profile}>
      <DialerProvider>
        <div className="flex h-screen overflow-hidden bg-bg-2">
          <Sidebar profile={profile} workspaceName={workspaceName} unread={notifications.unread}
            onSearch={() => setCmd(true)} onNotifications={() => setNotifOpen(true)} collapsed={collapsed} onCollapse={toggleCollapsed} />
          <main className="relative m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg first:ml-2">
            {collapsed && (
              <button onClick={toggleCollapsed} className="absolute left-2 top-2 z-20 rounded-md p-1.5 text-fg-3 hover:bg-hover cursor-pointer" aria-label="Expand sidebar">
                <PanelLeftOpen className="size-4" />
              </button>
            )}
            <div className={collapsed ? "flex min-h-0 flex-1 flex-col pl-8" : "flex min-h-0 flex-1 flex-col"}>{children}</div>
          </main>
        </div>
        <CommandMenu open={cmd} onOpenChange={setCmd} />
        <NotificationsPanel open={notifOpen} onOpenChange={setNotifOpen} state={notifications} />
      </DialerProvider>
    </ProfileProvider>
  );
}
