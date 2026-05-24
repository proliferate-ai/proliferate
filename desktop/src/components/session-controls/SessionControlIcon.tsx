import type { ComponentType } from "react";
import type { SessionControlIconKey } from "@/lib/domain/chat/session-controls/presentation";
import {
  BuildModeFilled,
  CircleQuestion,
  ClaudeSparkle,
  ClipboardListFilled,
  EditModeFilled,
  MessageSquareFilled,
  OpencodeBuildModeFilled,
  OpencodePlanModeFilled,
  ReadModeFilled,
  ShieldCheckFilled,
  Zap,
} from "@/components/ui/icons";

interface SessionControlIconProps {
  icon: SessionControlIconKey | null | undefined;
  className?: string;
}

const SESSION_CONTROL_ICONS: Record<SessionControlIconKey, ComponentType<{ className?: string }>> = {
  build: BuildModeFilled,
  chat: MessageSquareFilled,
  edit: EditModeFilled,
  opencodeBuild: OpencodeBuildModeFilled,
  opencodePlan: OpencodePlanModeFilled,
  plan: ClipboardListFilled,
  read: ReadModeFilled,
  shieldCheck: ShieldCheckFilled,
  sparkles: ClaudeSparkle,
  zap: Zap,
};

export function SessionControlIcon({
  icon,
  className = "size-3.5",
}: SessionControlIconProps) {
  const Icon = icon ? SESSION_CONTROL_ICONS[icon] : CircleQuestion;
  return <Icon className={className} />;
}
