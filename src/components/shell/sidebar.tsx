"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, LogOut, PanelLeftClose, Search, Bell, Phone, User as UserIcon } from "lucide-react";
import { useDialer } from "@/components/comms/dialer";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { NAV, SETTINGS_ITEM, type NavItem } from "./nav";
import { Avatar } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ThemeToggle } from "./theme-toggle";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

function NavLink({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  return (
    <Link
      href={item.href}
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
        active ? "bg-active text-fg font-medium" : "text-fg-2 hover:bg-hover hover:text-fg",
      )}
    >
      <item.icon className={cn("size-4", active ? "text-fg" : "text-fg-3")} />
      <span className="truncate">{item.label}</span>
      {!!badge && <span className="ml-auto rounded-sm bg-accent px-1 text-[10px] font-semibold text-white">{badge}</span>}
    </Link>
  );
}

export function Sidebar({ profile, workspaceName, unread, onSearch, onNotifications, collapsed, onCollapse }: {
  profile: Profile; workspaceName: string; unread: number; onSearch: () => void; onNotifications: () => void; collapsed: boolean; onCollapse: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const dialer = useDialer();
  const isActive = (href: string) => pathname === href || (href !== "/finance" && pathname.startsWith(href + "/")) || (href === "/finance" && pathname === "/finance");

  if (collapsed) return null;

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col bg-bg-2 px-2 py-2">
      <div className="flex items-center gap-1">
        <Menu>
          <MenuTrigger asChild>
            <button className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 hover:bg-hover cursor-pointer">
              <span className="flex size-5 items-center justify-center rounded-sm bg-fg text-[11px] font-bold text-bg">R</span>
              <span className="truncate text-[13px] font-semibold">{workspaceName}</span>
              <ChevronDown className="size-3.5 text-fg-3" />
            </button>
          </MenuTrigger>
          <MenuContent width={210}>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Avatar name={profile.full_name || profile.email} src={profile.avatar_url} size={24} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{profile.full_name}</div>
                <div className="truncate text-xs text-fg-3">{profile.email}</div>
              </div>
            </div>
            <MenuSeparator />
            <MenuItem icon={UserIcon} onSelect={() => router.push("/settings?tab=profile")}>My profile</MenuItem>
            <MenuItem icon={LogOut} onSelect={signOut}>Log out</MenuItem>
          </MenuContent>
        </Menu>
        <button onClick={onCollapse} className="rounded-md p-1.5 text-fg-3 hover:bg-hover hover:text-fg cursor-pointer" aria-label="Collapse sidebar">
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="mt-2 space-y-px">
        <button onClick={onSearch} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover hover:text-fg cursor-pointer">
          <Search className="size-4 text-fg-3" /> Search <span className="ml-auto"><Kbd>⌘K</Kbd></span>
        </button>
        <button onClick={onNotifications} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover hover:text-fg cursor-pointer">
          <Bell className="size-4 text-fg-3" /> Notifications
          {unread > 0 && <span className="ml-auto rounded-sm bg-accent px-1 text-[10px] font-semibold text-white">{unread}</span>}
        </button>
        <button onClick={() => dialer.open?.()} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover hover:text-fg cursor-pointer">
          <Phone className="size-4 text-fg-3" /> Phone
        </button>
        <NavLink item={SETTINGS_ITEM} active={isActive("/settings")} />
      </div>

      <nav className="mt-4 flex-1 space-y-4 overflow-y-auto">
        {NAV.map((section) => {
          const items = section.items.filter((i) => !i.roles || i.roles.includes(profile.role));
          if (!items.length) return null;
          const closed = open[section.label] === false;
          return (
            <div key={section.label}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [section.label]: closed }))}
                className="flex h-6 w-full items-center px-2 text-xs font-medium text-fg-3 hover:text-fg-2 cursor-pointer"
              >
                {section.label}
              </button>
              {!closed && <div className="space-y-px">{items.map((i) => <NavLink key={i.href} item={i} active={isActive(i.href)} />)}</div>}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border-light pt-2">
        <ThemeToggle />
      </div>
    </aside>
  );
}
