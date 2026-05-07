import { Button } from "@/components/ui/Button";
import {
  ArrowRight,
  BrailleSweepBadge,
  CircleAlert,
  CloudIcon,
  FolderOpen,
  GitBranch,
  GitCommit,
} from "@/components/ui/icons";
import { mobilityReconnectCopy } from "@/lib/domain/workspaces/mobility/presentation";
import { ComposerPopoverSurface } from "./ComposerPopoverSurface";
import type { MobilityPromptState } from "@/lib/domain/workspaces/mobility-prompt";
import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";

function HandoffRoute({ direction }: { direction: WorkspaceMobilityDirection }) {
  const source = direction === "cloud_to_local"
    ? { label: "Cloud", icon: <CloudIcon className="size-3.5" /> }
    : { label: "Local", icon: <FolderOpen className="size-3.5" /> };
  const destination = direction === "cloud_to_local"
    ? { label: "Local", icon: <FolderOpen className="size-3.5" /> }
    : { label: "Cloud", icon: <CloudIcon className="size-3.5" /> };

  return (
    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        {source.icon}
        {source.label}
      </span>
      <ArrowRight className="size-3.5 text-muted-foreground/60" />
      <span className="inline-flex items-center gap-1.5 text-foreground">
        {destination.icon}
        {destination.label}
      </span>
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
  const leading = prompt.variant === "loading"
    ? <BrailleSweepBadge className="text-base text-foreground" />
    : prompt.variant === "blocked"
      ? <CircleAlert className="size-4 text-destructive" />
      : null;
  const hasPrimaryAction = Boolean(prompt.actionLabel && prompt.primaryActionKind);
  const secondaryLabel = hasPrimaryAction
    ? "Cancel"
    : prompt.variant === "actionable" || prompt.variant === "loading"
      ? "Cancel"
      : "Got it";

  return (
    <ComposerPopoverSurface className="w-[min(26rem,calc(100vw-2rem))] p-0">
      <div className="space-y-3 px-4 py-3.5">
        {prompt.direction && (
          <HandoffRoute direction={prompt.direction} />
        )}

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
