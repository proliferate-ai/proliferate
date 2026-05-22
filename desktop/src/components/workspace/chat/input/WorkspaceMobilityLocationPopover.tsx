import { Button } from "@proliferate/ui/primitives/Button";
import type { ReactNode } from "react";
import {
  CircleAlert,
  CloudIcon,
  FolderOpen,
  GitBranch,
  GitCommit,
} from "@/components/ui/icons";
import { mobilityReconnectCopy } from "@/lib/domain/workspaces/mobility/presentation";
import { ComposerPopoverSurface } from "./ComposerPopoverSurface";
import type { MobilityPromptState } from "@/lib/domain/workspaces/mobility/mobility-prompt";
import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";

function MigrationTargetPreview({
  direction,
  stateLabel,
}: {
  direction: WorkspaceMobilityDirection | null;
  stateLabel: string;
}) {
  const source = direction === "cloud_to_local"
    ? {
      label: "Cloud workspace",
      detail: "Current runtime",
      icon: <CloudIcon className="size-3.5" />,
    }
    : {
      label: "Local workspace",
      detail: "Current runtime",
      icon: <FolderOpen className="size-3.5" />,
    };
  const destination = direction === "cloud_to_local"
    ? {
      label: "Local workspace",
      detail: "Destination",
      icon: <FolderOpen className="size-3.5" />,
    }
    : {
      label: "Cloud workspace",
      detail: "Destination",
      icon: <CloudIcon className="size-3.5" />,
    };

  return (
    <div className="rounded-lg border border-border/70 bg-[var(--color-composer-control-hover)]/45 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
          Move target
        </span>
        <span className="truncate text-[11px] text-muted-foreground/80">
          {stateLabel}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-1.5">
        <TargetEndpoint
          icon={source.icon}
          label={source.label}
          detail={source.detail}
        />
        <div className="flex items-center justify-center text-muted-foreground/55" aria-hidden="true">
          <span className="h-px w-4 bg-border/80" />
        </div>
        <TargetEndpoint
          icon={destination.icon}
          label={destination.label}
          detail={destination.detail}
          emphasized
        />
      </div>
    </div>
  );
}

function TargetEndpoint({
  detail,
  emphasized = false,
  icon,
  label,
}: {
  detail: string;
  emphasized?: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <div className={`min-w-0 rounded-md border px-2 py-1.5 ${
      emphasized
        ? "border-border bg-background/55 text-foreground"
        : "border-transparent bg-background/25 text-muted-foreground"
    }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 truncate text-xs font-medium">{label}</span>
      </div>
      <div className="mt-0.5 truncate pl-5 text-[11px] text-muted-foreground/80">
        {detail}
      </div>
    </div>
  );
}

function HandoffSnapshotDetails({
  snapshot,
}: {
  snapshot: WorkspaceMobilityConfirmSnapshot;
}) {
  const branchName = snapshot.sourcePreflight.branchName?.trim()
    || snapshot.cloudPreflight.workspace?.repo?.branch?.trim()
    || "Current branch";
  const baseCommitSha = snapshot.sourcePreflight.baseCommitSha?.trim() ?? null;

  return (
    <div className="space-y-2 border-y border-border/60 py-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className="shrink-0 text-muted-foreground">Branch</span>
        <span className="min-w-0 truncate text-foreground" title={branchName}>
          {branchName}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <GitCommit className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className="shrink-0 text-muted-foreground">Sync basis</span>
        <span className="min-w-0 truncate text-foreground">
          {baseCommitSha ? `Base commit ${baseCommitSha.slice(0, 8)}` : "Current workspace base"}
        </span>
      </div>
    </div>
  );
}

export function WorkspaceMobilityLocationPopover({
  prompt,
  snapshot,
  isActionPending = false,
  onClose,
  onPrimaryAction,
}: {
  prompt: MobilityPromptState;
  snapshot: WorkspaceMobilityConfirmSnapshot | null;
  isActionPending?: boolean;
  onClose: () => void;
  onPrimaryAction: () => void | Promise<void>;
}) {
  const leading = prompt.variant === "blocked"
      ? <CircleAlert className="size-4 text-destructive" />
      : null;
  const hasPrimaryAction = Boolean(prompt.actionLabel && prompt.primaryActionKind);
  const secondaryLabel = hasPrimaryAction
    ? "Cancel"
    : prompt.variant === "actionable" || prompt.variant === "loading"
      ? "Cancel"
      : "Got it";
  const targetStateLabel = prompt.variant === "loading"
    ? "Preparing"
    : prompt.variant === "blocked"
      ? "Blocked"
      : "Ready";

  return (
    <ComposerPopoverSurface className="w-[min(26rem,calc(100vw-2rem))] p-0">
      <div className="space-y-3 px-4 py-3.5">
        <MigrationTargetPreview
          direction={prompt.direction}
          stateLabel={targetStateLabel}
        />

        {prompt.variant !== "loading" && (
          <div className="flex items-start gap-2.5">
            {leading ? <div className="pt-0.5">{leading}</div> : null}
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-foreground">
                {prompt.headline}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {prompt.body}
              </p>
              {prompt.helper && (
                <p className="mt-1 text-xs text-muted-foreground/80">
                  {prompt.helper}
                </p>
              )}
            </div>
          </div>
        )}

        {prompt.variant === "actionable" && snapshot && (
          <HandoffSnapshotDetails snapshot={snapshot} />
        )}

        {prompt.warning && (
          <p className="text-xs leading-5 text-muted-foreground">
            {prompt.warning}
          </p>
        )}

        {prompt.variant === "actionable" && (
          <p className="text-xs leading-5 text-muted-foreground/80">
            {mobilityReconnectCopy(prompt.direction)}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            {secondaryLabel}
          </Button>
          {prompt.actionLabel && prompt.primaryActionKind && (
            <Button
              size="sm"
              loading={isActionPending}
              onClick={() => {
                void onPrimaryAction();
              }}
            >
              {prompt.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </ComposerPopoverSurface>
  );
}
