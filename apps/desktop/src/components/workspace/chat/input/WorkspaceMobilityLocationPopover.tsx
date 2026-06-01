import { Button } from "@proliferate/ui/primitives/Button";
import type { ReactNode } from "react";
import { ComputeTargetSwatch } from "@/components/compute/ComputeTargetSwatch";
import { POPOVER_SURFACE_CLASS } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  Check,
  CircleAlert,
  CloudIcon,
  FolderOpen,
  GitBranch,
  GitCommit,
  Spinner,
  Terminal,
  Tree,
} from "@proliferate/ui/icons";
import { mobilityReconnectCopy } from "@/lib/domain/workspaces/mobility/presentation";
import type { MobilityPromptState } from "@/lib/domain/workspaces/mobility/mobility-prompt";
import type {
  WorkspaceMobilityDestinationId,
  WorkspaceMobilityDestinationOption,
} from "@/lib/domain/workspaces/mobility/mobility-destinations";
import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";

const MOBILITY_PICKER_SURFACE_CLASS = `w-60 min-w-[175px] ${POPOVER_SURFACE_CLASS}`;
const MOBILITY_PROMPT_SURFACE_CLASS = `w-80 min-w-[175px] ${POPOVER_SURFACE_CLASS}`;
const MOBILITY_SECTION_CLASS =
  "flex min-h-6 items-center truncate px-2 py-1 text-sm leading-4 text-muted-foreground";
const MOBILITY_DIVIDER_CLASS = "mx-1 my-1.5 h-px scale-y-50 bg-foreground/10";

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

function DestinationOptionIcon({
  option,
}: {
  option: WorkspaceMobilityDestinationOption;
}) {
  if (option.targetOption) {
    return <ComputeTargetSwatch appearance={option.targetOption.appearance} size="inherit" />;
  }
  switch (option.kind) {
    case "cloud_workspace":
      return <CloudIcon className="size-full" />;
    case "ssh_target":
      return <Terminal className="size-full" />;
    case "local_worktree":
      return <Tree className="size-full" />;
    case "local_workspace":
    default:
      return <FolderOpen className="size-full" />;
  }
}

function MobilitySection({ children }: { children: ReactNode }) {
  return (
    <div className={MOBILITY_SECTION_CLASS}>
      {children}
    </div>
  );
}

function MobilityMenuItem({
  disabled = false,
  icon,
  label,
  onClick,
  selected = false,
  title,
}: {
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  selected?: boolean;
  title?: string;
}) {
  return (
    <PopoverMenuItem
      density="compact"
      disabled={disabled}
      title={title}
      icon={icon}
      label={label}
      trailing={selected ? <Check className="size-3.5" /> : null}
      onClick={() => {
        onClick();
      }}
    />
  );
}

function MobilityEmptyRow({ label }: { label: string }) {
  return (
    <div className="px-2 py-1 text-sm leading-4 text-muted-foreground">
      {label}
    </div>
  );
}

function DestinationPicker({
  options,
  onSelectDestination,
}: {
  options: WorkspaceMobilityDestinationOption[];
  onSelectDestination: (destination: WorkspaceMobilityDestinationOption) => void;
}) {
  return (
    <div className={MOBILITY_PICKER_SURFACE_CLASS}>
      <MobilitySection>Move to</MobilitySection>
      {options.length === 0 ? (
        <MobilityEmptyRow label="No destinations" />
      ) : (
        options.map((option) => (
          <MobilityMenuItem
            key={option.id}
            icon={<DestinationOptionIcon option={option} />}
            label={option.label}
            disabled={Boolean(option.disabledReason)}
            title={option.disabledReason ?? option.detail}
            onClick={() => onSelectDestination(option)}
          />
        ))
      )}
    </div>
  );
}

function SelectedDestinationRow({
  destination,
  disabled = false,
  onBackToDestinations,
}: {
  destination: WorkspaceMobilityDestinationOption;
  disabled?: boolean;
  onBackToDestinations?: () => void;
}) {
  return (
    <MobilityMenuItem
      icon={<DestinationOptionIcon option={destination} />}
      label={destination.label}
      selected
      disabled={disabled}
      title={destination.detail}
      onClick={() => {
        onBackToDestinations?.();
      }}
    />
  );
}

export function WorkspaceMobilityLocationPopover({
  destinationOptions,
  selectedDestinationId,
  prompt,
  snapshot,
  isActionPending = false,
  onClose,
  onSelectDestination,
  onBackToDestinations,
  onPrimaryAction,
}: {
  destinationOptions: WorkspaceMobilityDestinationOption[];
  selectedDestinationId: WorkspaceMobilityDestinationId | null;
  prompt: MobilityPromptState | null;
  snapshot: WorkspaceMobilityConfirmSnapshot | null;
  isActionPending?: boolean;
  onClose: () => void;
  onSelectDestination: (destination: WorkspaceMobilityDestinationOption) => void;
  onBackToDestinations?: () => void;
  onPrimaryAction: () => void | Promise<void>;
}) {
  const selectedDestination = selectedDestinationId
    ? destinationOptions.find((option) => option.id === selectedDestinationId) ?? null
    : null;

  if (!selectedDestinationId || !prompt) {
    return (
      <DestinationPicker
        options={destinationOptions}
        onSelectDestination={onSelectDestination}
      />
    );
  }

  const leading = prompt.variant === "blocked"
      ? <CircleAlert className="size-4 text-destructive" />
      : null;
  const hasPrimaryAction = Boolean(prompt.actionLabel && prompt.primaryActionKind);
  const secondaryLabel = hasPrimaryAction
    ? "Cancel"
    : prompt.variant === "actionable" || prompt.variant === "loading"
      ? "Cancel"
      : "Got it";
  if (!selectedDestination) {
    return null;
  }

  return (
    <div className={MOBILITY_PROMPT_SURFACE_CLASS}>
      <MobilitySection>Move to</MobilitySection>
      <SelectedDestinationRow
        destination={selectedDestination}
        disabled={isActionPending}
        onBackToDestinations={isActionPending ? undefined : onBackToDestinations}
      />
      <div className={MOBILITY_DIVIDER_CLASS} />

      {prompt.variant === "loading" ? (
        <div className="flex min-h-6 items-center gap-1.5 px-2 py-1 text-sm leading-4 text-muted-foreground">
          <Spinner className="size-3" />
          <span>Preparing</span>
        </div>
      ) : (
        <div className="space-y-2 px-2 pb-2 pt-1">
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

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isActionPending}
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
      )}
    </div>
  );
}
