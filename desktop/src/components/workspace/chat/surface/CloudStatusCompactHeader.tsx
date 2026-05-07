import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { CloudWorkspaceCompactStatusTone } from "@/lib/domain/workspaces/cloud-workspace-status-presentation";

interface CloudStatusCompactHeaderProps {
  title: string;
  phaseLabel: string;
  tone: CloudWorkspaceCompactStatusTone;
  statusIcon: ReactNode;
  primaryAction?: {
    label: string;
    loading?: boolean;
    onClick: () => void;
  } | null;
  expanded: boolean;
  onToggleExpanded: () => void;
}

const toneClasses: Record<CloudWorkspaceCompactStatusTone, string> = {
  info: "bg-info/10 text-info",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive/10 text-destructive",
};

export function CloudStatusCompactHeader({
  title,
  phaseLabel,
  tone,
  statusIcon,
  primaryAction,
}: CloudStatusCompactHeaderProps) {
  return (
    <>
      <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${toneClasses[tone]}`}>
        {statusIcon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{phaseLabel}</span>
      </span>
      {primaryAction && (
        <Button
          type="button"
          size="pill"
          variant={tone === "destructive" ? "outline" : "ghost"}
          loading={primaryAction.loading}
          onClick={(event) => {
            event.stopPropagation();
            primaryAction.onClick();
          }}
          className="shrink-0"
        >
          {primaryAction.label}
        </Button>
      )}
    </>
  );
}
