import type { ComponentType } from "react";
import type { SessionControlIconKey } from "@/lib/domain/chat/session-controls/presentation";
import {
  CircleQuestion,
  EditModeFilled,
  MessageSquareFilled,
  PlanningIcon,
  ReadModeFilled,
  ShieldCheckFilled,
  Zap,
} from "@/components/ui/icons";

interface SessionControlIconProps {
  icon: SessionControlIconKey | null | undefined;
  className?: string;
}

const SESSION_CONTROL_ICONS: Record<SessionControlIconKey, ComponentType<{ className?: string }>> = {
  chat: MessageSquareFilled,
  edit: EditModeFilled,
  plan: PlanningIcon,
  read: ReadModeFilled,
  shieldCheck: ShieldCheckFilled,
  zap: Zap,
};

export function SessionControlIcon({
  icon,
  className = "size-3.5",
}: SessionControlIconProps) {
  const Icon = icon ? SESSION_CONTROL_ICONS[icon] : CircleQuestion;
  return <Icon className={className} />;
}
