import {
  Zap, MessageSquare, Mail, Clock, GitBranch, CircleStop, UserPen, Tag, TagsIcon, UserCheck, ListTodo, Target, Bell, Sparkles, Webhook,
  type LucideIcon,
} from "lucide-react";
import type { AutomationNodeType } from "@/lib/types";

export const NODE_ICONS: Record<AutomationNodeType, LucideIcon> = {
  trigger: Zap,
  send_sms: MessageSquare,
  send_email: Mail,
  wait: Clock,
  condition: GitBranch,
  end: CircleStop,
  update_contact: UserPen,
  add_tag: Tag,
  remove_tag: TagsIcon,
  assign_owner: UserCheck,
  create_task: ListTodo,
  move_stage: Target,
  notify: Bell,
  ai_generate: Sparkles,
  webhook: Webhook,
};
