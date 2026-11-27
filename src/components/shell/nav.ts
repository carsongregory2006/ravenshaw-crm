import {
  LayoutDashboard, User, Building2, Target, BadgeCheck, Rocket, MessagesSquare, Calendar, CheckSquare,
  BarChart3, Landmark, Phone, Zap, Users, TrendingUp, Receipt, Wallet, Coins, Globe, Workflow, Settings, CalendarCheck, FolderKanban,
  Megaphone, Archive, Trophy, LayoutTemplate, Filter, Bot, Gauge, type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/types";

export interface NavItem { href: string; label: string; icon: LucideIcon; roles?: UserRole[] }
/** A sidebar button. Its pages show as tabs across the top of the page. */
export interface NavHub extends NavItem { pages: NavItem[] }
export interface NavSection { label: string; items: NavHub[] }

const STAFF: UserRole[] = ["admin", "ops"];
const ADMIN: UserRole[] = ["admin"];
const hub = (h: Omit<NavHub, "pages"> & { pages?: NavItem[] }): NavHub => ({ ...h, pages: h.pages ?? [{ href: h.href, label: h.label, icon: h.icon, roles: h.roles }] });

export const NAV: NavSection[] = [
  {
    label: "Workspace",
    items: [
      hub({ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }),
      hub({ href: "/inbox", label: "Inbox", icon: MessagesSquare, pages: [
        { href: "/inbox", label: "Inbox", icon: MessagesSquare },
        { href: "/phone", label: "Phone", icon: Phone },
      ] }),
      hub({ href: "/calendar", label: "Calendar", icon: Calendar }),
      hub({ href: "/tasks", label: "My work", icon: CheckSquare, pages: [
        { href: "/tasks", label: "Tasks", icon: CheckSquare },
        { href: "/daily", label: "Daily inputs", icon: CalendarCheck, roles: STAFF },
        { href: "/projects", label: "Projects", icon: FolderKanban, roles: STAFF },
      ] }),
    ],
  },
  {
    label: "Sales",
    items: [
      hub({ href: "/contacts", label: "People", icon: User, pages: [
        { href: "/contacts", label: "People", icon: User },
        { href: "/network", label: "Network", icon: Users },
        { href: "/companies", label: "Companies", icon: Building2 },
      ] }),
      hub({ href: "/deals", label: "Deals", icon: Target }),
      hub({ href: "/dialer", label: "Calling", icon: Zap, pages: [
        { href: "/dialer", label: "Power Dialer", icon: Zap },
        { href: "/cold-calling", label: "Cold Calling", icon: TrendingUp },
      ] }),
      hub({ href: "/clients", label: "Clients", icon: BadgeCheck, pages: [
        { href: "/clients", label: "Clients", icon: BadgeCheck },
        { href: "/onboarding", label: "Onboarding", icon: Rocket },
      ] }),
    ],
  },
  {
    label: "Growth",
    items: [
      hub({ href: "/marketing", label: "Marketing", icon: Megaphone, roles: ADMIN, pages: [
        { href: "/marketing", label: "Dashboard", icon: Gauge, roles: ADMIN },
        { href: "/marketing/campaigns", label: "Campaigns", icon: Megaphone, roles: ADMIN },
        { href: "/marketing/funnel", label: "Funnel", icon: Filter, roles: ADMIN },
        { href: "/marketing/agents", label: "Agents", icon: Bot, roles: ADMIN },
        { href: "/marketing/winners", label: "Winners", icon: Trophy, roles: ADMIN },
        { href: "/marketing/landers", label: "Landers & forms", icon: LayoutTemplate, roles: ADMIN },
        { href: "/marketing/past", label: "Past campaigns", icon: Archive, roles: ADMIN },
      ] }),
      hub({ href: "/analytics", label: "Analytics", icon: BarChart3, pages: [
        { href: "/analytics", label: "Analytics", icon: BarChart3 },
        { href: "/landing-pages", label: "Landers", icon: Globe, roles: STAFF },
        { href: "/automations", label: "Automations", icon: Workflow, roles: STAFF },
      ] }),
      hub({ href: "/finance", label: "Finance", icon: Landmark, pages: [
        { href: "/finance", label: "P&L Overview", icon: Landmark, roles: STAFF },
        { href: "/finance/invoices", label: "Invoices", icon: Receipt, roles: STAFF },
        { href: "/finance/expenses", label: "Expenses", icon: Wallet, roles: STAFF },
        { href: "/finance/commissions", label: "Commissions", icon: Coins },
      ] }),
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings };
export const ALL_PAGES: NavItem[] = NAV.flatMap((s) => s.items.flatMap((h) => h.pages));

const can = (i: NavItem, role: UserRole) => !i.roles || i.roles.includes(role);
/** Pages of a hub this role can open. A hub shows if at least one is visible; it links to the first. */
export const visiblePages = (h: NavHub, role: UserRole) => h.pages.filter((p) => can(p, role));

/** The page (and its hub) the path belongs to: longest matching href wins, so /finance/invoices beats /finance. */
export function matchPage(pathname: string) {
  let best: { hub: NavHub; page: NavItem } | null = null;
  for (const s of NAV) for (const h of s.items) for (const p of h.pages) {
    if ((pathname === p.href || pathname.startsWith(p.href + "/")) && (!best || p.href.length > best.page.href.length)) best = { hub: h, page: p };
  }
  return best;
}

