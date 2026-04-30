import type { ComponentType } from "react";
import type { SessionControlIconKey } from "@/config/session-control-presentations";
import {
  CircleQuestion,
  FileText,
  Pencil,
  PlanningIcon,
  Shield,
  Zap,
} from "@/components/ui/icons";

type IconComponent = ComponentType<{ className?: string }>;

const SESSION_CONTROL_ICONS: Record<SessionControlIconKey, IconComponent> = {
  ask: CircleQuestion,
  edit: Pencil,
  inspect: FileText,
  permission: Shield,
  plan: PlanningIcon,
  unknown: CircleQuestion,
  unrestricted: Zap,
};

export function SessionControlIcon({
  icon,
  className,
}: {
  icon: SessionControlIconKey;
  className?: string;
}) {
  const Icon = SESSION_CONTROL_ICONS[icon];
  return <Icon className={className} />;
}
