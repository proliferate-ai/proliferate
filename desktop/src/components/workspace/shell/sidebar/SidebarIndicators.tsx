import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";
import {
  ArrowRight,
  CircleAlert,
  CircleUser,
  Clock,
  GitMerge,
  Globe,
  BotMessageSquare,
  MessageSquare,
  Spinner,
} from "@/components/ui/icons";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type {
  SidebarDetailIndicator,
  SidebarIndicatorAction,
  SidebarStatusIndicator,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import { SidebarWorkspaceVariantIcon } from "./SidebarWorkspaceVariantIcon";

interface SidebarStatusIndicatorViewProps {
  indicator: SidebarStatusIndicator | null | undefined;
  onAction?: (action: SidebarIndicatorAction) => void;
}

interface SidebarDetailIndicatorsViewProps {
  indicators: SidebarDetailIndicator[];
  archived?: boolean;
  onAction?: (action: SidebarIndicatorAction) => void;
}

interface SidebarStatusGlyphProps {
  indicator: SidebarStatusIndicator;
}

export function SidebarStatusGlyph({
  indicator,
}: SidebarStatusGlyphProps): ReactNode {
  switch (indicator.kind) {
    case "error":
      return <CircleAlert className="size-3 text-destructive" />;
    case "waiting_input":
    case "waiting_plan":
    case "needs_review":
      return <Clock className="size-3 text-info" />;
    case "iterating":
    case "queued_prompt":
      return <Spinner className="size-3.5 text-sidebar-foreground" />;
  }
}

export function SidebarStatusIndicatorView({
  indicator,
  onAction,
}: SidebarStatusIndicatorViewProps) {
  if (!indicator) {
    return null;
  }

  const action = "action" in indicator ? indicator.action : null;
  const glyph = <SidebarStatusGlyph indicator={indicator} />;

  return (
    <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
      {action && onAction ? (
        <IconButton
          tone="sidebar"
          size="sm"
          title={indicator.tooltip}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onAction(action);
          }}
          className="!size-4 !px-0 hover:bg-transparent"
        >
          {glyph}
        </IconButton>
      ) : (
        glyph
      )}
    </Tooltip>
  );
}

export function SidebarDetailIndicatorsView({
  indicators,
  archived = false,
  onAction,
}: SidebarDetailIndicatorsViewProps) {
  if (indicators.length === 0) {
    return null;
  }

  const className = archived
    ? "text-sidebar-muted-foreground/40"
    : "text-sidebar-muted-foreground";

  return (
    <>
      {indicators.map((indicator) => (
        <SidebarDetailIndicatorView
          key={detailIndicatorKey(indicator)}
          indicator={indicator}
          className={className}
          onAction={onAction}
        />
      ))}
    </>
  );
}

function SidebarDetailIndicatorView({
  indicator,
  className,
  onAction,
}: {
  indicator: SidebarDetailIndicator;
  className: string;
  onAction?: (action: SidebarIndicatorAction) => void;
}) {
  if (indicator.kind === "materialization") {
    return (
      <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
        <SidebarWorkspaceVariantIcon
          variant={indicator.variant}
          targetAppearance={indicator.targetAppearance ?? null}
          className={`size-3 ${className}`}
        />
      </Tooltip>
    );
  }

  if (indicator.kind === "finish_suggestion") {
    return (
      <FinishSuggestionIndicator
        indicator={indicator}
        className={className}
        onAction={onAction}
      />
    );
  }

  if (indicator.kind === "cloud_access" || indicator.kind === "cloud_exposure") {
    const glyph = indicator.kind === "cloud_access"
      ? <CircleUser className="size-3" />
      : <Globe className="size-3" />;
    return (
      <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
        <span className={detailToneClass(indicator.tone, className)}>
          {glyph}
        </span>
      </Tooltip>
    );
  }

  const glyph = indicator.kind === "automation"
    ? <BotMessageSquare className="size-3" />
    : indicator.kind === "agent"
      ? <MessageSquare className="size-3" />
      : <ArrowRight className="size-3" />;
  const action = "action" in indicator ? indicator.action ?? null : null;

  return (
    <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
      {action && onAction ? (
        <IconButton
          tone="sidebar"
          size="sm"
          title={indicator.tooltip}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onAction(action);
          }}
          className={`!size-4 !px-0 hover:bg-transparent ${className}`}
        >
          {glyph}
        </IconButton>
      ) : (
        <span className={className}>{glyph}</span>
      )}
    </Tooltip>
  );
}

function detailToneClass(
  tone: "neutral" | "success" | "warning" | "muted",
  fallbackClassName: string,
): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "muted":
      return "text-sidebar-muted-foreground/50";
    case "neutral":
    default:
      return fallbackClassName;
  }
}

function FinishSuggestionIndicator({
  indicator,
  className,
  onAction,
}: {
  indicator: Extract<SidebarDetailIndicator, { kind: "finish_suggestion" }>;
  className: string;
  onAction?: (action: SidebarIndicatorAction) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const trigger = (
    <IconButton
      tone="sidebar"
      size="sm"
      title={indicator.tooltip}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
      }}
      className={`!size-4 !px-0 hover:bg-transparent ${className}`}
    >
      <GitMerge className="size-3" />
    </IconButton>
  );

  return (
    <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
      <PopoverButton
        trigger={trigger}
        stopPropagation
        className={`w-64 ${POPOVER_SURFACE_CLASS}`}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirming(false);
        }}
      >
        {(close) => confirming ? (
          <>
            <div className="px-2.5 py-2 text-sm text-foreground">
              <div className="font-medium">Delete workspace?</div>
              <div className="mt-1 text-xs leading-4 text-muted-foreground">
                This removes the local worktree, workspace record, chat history, and local agent
                artifacts for this workspace. Commits, branches, and pull requests are not deleted.
              </div>
              <div className="mt-1 text-xs leading-4 text-muted-foreground">
                This cannot be undone from Proliferate.
              </div>
            </div>
            <PopoverMenuItem
              label="Delete workspace"
              variant="sidebar"
              onClick={() => {
                close();
                onAction?.({
                  kind: "mark_workspace_done",
                  workspaceId: indicator.workspaceId,
                  logicalWorkspaceId: indicator.logicalWorkspaceId,
                });
              }}
            />
            <PopoverMenuItem
              label="Cancel"
              variant="sidebar"
              onClick={() => setConfirming(false)}
            />
          </>
        ) : (
          <>
            <PopoverMenuItem
              label="Delete workspace..."
              variant="sidebar"
              onClick={() => setConfirming(true)}
            />
            <PopoverMenuItem
              label="Keep active"
              variant="sidebar"
              onClick={() => {
                close();
                onAction?.({
                  kind: "keep_workspace_active",
                  workspaceId: indicator.workspaceId,
                  readinessFingerprint: indicator.readinessFingerprint,
                });
              }}
            />
          </>
        )}
      </PopoverButton>
    </Tooltip>
  );
}

function detailIndicatorKey(indicator: SidebarDetailIndicator): string {
  switch (indicator.kind) {
    case "materialization":
      return `materialization:${indicator.variant}`;
    case "cloud_access":
      return `cloud-access:${indicator.tooltip}`;
    case "cloud_exposure":
      return `cloud-exposure:${indicator.tooltip}`;
    case "origin":
      return `origin:${indicator.tooltip}`;
    case "automation":
      return "automation";
    case "agent":
      return "agent";
    case "finish_suggestion":
      return `finish:${indicator.workspaceId}:${indicator.readinessFingerprint}`;
  }
}
