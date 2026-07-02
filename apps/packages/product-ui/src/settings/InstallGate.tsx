import { type ReactNode } from "react";
import { SettingsEmptyState } from "./SettingsEmptyState";

export interface InstallGateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * Full-page "not installed → install" gate, shown in place of a pane's content
 * (CONTRACT §1/§3): a flat centered `SettingsEmptyState` — optional icon slot,
 * title, description, install action. No card.
 */
export function InstallGate({ icon, title, description, action, className }: InstallGateProps) {
  return (
    <SettingsEmptyState
      icon={icon}
      title={title}
      description={description}
      action={action}
      size="full"
      className={className}
    />
  );
}
