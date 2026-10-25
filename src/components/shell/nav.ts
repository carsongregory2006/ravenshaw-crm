import {
  LayoutDashboard, User, Building2, Target, BadgeCheck, Rocket, MessagesSquare, Calendar, CheckSquare,
  BarChart3, Landmark, Phone, Zap, TrendingUp, Receipt, Wallet, Coins, Globe, Workflow, Settings, type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/types";

export interface NavItem { href: string; label: string; icon: LucideIcon; roles?: UserRole[] }
export interface NavSection { label: string; items: NavItem[] }

const STAFF: UserRole[] = ["admin", "ops"];

export const NAV: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/contacts", label: "People", icon: User },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/deals", label: "Deals", icon: Target },
      { href: "/clients", label: "Clients", icon: BadgeCheck },
      { href: "/onboarding", label: "Onboarding", icon: Rocket },
      { href: "/inbox", label: "Inbox", icon: MessagesSquare },
      { href: "/phone", label: "Phone", icon: Phone },
      { href: "/dialer", label: "Power Dialer", icon: Zap },
      { href: "/cold-calling", label: "Cold Calling", icon: TrendingUp },
      { href: "/calendar", label: "Calendar", icon: Calendar },
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/landing-pages", label: "Landing Pages", icon: Globe, roles: STAFF },
      { href: "/automations", label: "Automations", icon: Workflow, roles: STAFF },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/finance", label: "P&L Overview", icon: Landmark, roles: STAFF },
      { href: "/finance/invoices", label: "Invoices", icon: Receipt, roles: STAFF },
      { href: "/finance/expenses", label: "Expenses", icon: Wallet, roles: STAFF },
      { href: "/finance/commissions", label: "Commissions", icon: Coins },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings };
