import type { MouseEvent, ReactNode } from "react";
import { ComputeTargetSwatch } from "@/components/compute/ComputeTargetSwatch";
import { PillControlButton } from "@/components/ui/PillControlButton";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@/components/ui/PopoverButton";
import {
  Check,
  CloudIcon,
  FolderOpen,
  Plus,
  Terminal,
} from "@/components/ui/icons";
import type {
  AutomationTargetGroup,
  AutomationTargetRow,
  AutomationTargetSelection,
} from "@/lib/domain/automations/target/selection";

type AutomationRunOwnerScope = "personal" | "organization";

interface AutomationOwnerOption {
  value: AutomationRunOwnerScope;
  label: string;
  description: string;
  disabledReason?: string | null;
}

interface AutomationRunLocationSelectorProps {
  ownerScope: AutomationRunOwnerScope;
  canChangeOwner: boolean;
  ownerOptions: AutomationOwnerOption[];
  personalGroups: AutomationTargetGroup[];
  teamGroups: AutomationTargetGroup[];
  isLoading: boolean;
  disabledReason: string | null;
  onSelectOwner: (ownerScope: AutomationRunOwnerScope) => void;
  onSelectTarget: (target: AutomationTargetSelection) => void;
  onConfigureCloud: (target: {
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationRunOwnerScope;
  }) => void;
}

const RUN_LOCATION_SURFACE_CLASS = `w-72 min-w-[175px] ${POPOVER_SURFACE_CLASS}`;
const RUN_LOCATION_SECTION_CLASS =
  "flex min-h-6 items-center truncate px-2 py-1 text-sm leading-4 text-muted-foreground";
const RUN_LOCATION_DIVIDER_CLASS = "mx-1 my-1.5 h-px scale-y-50 bg-foreground/10";

export function AutomationRunLocationSelector({
  ownerScope,
  canChangeOwner,
  ownerOptions,
  personalGroups,
  teamGroups,
  isLoading,
  disabledReason,
  onSelectOwner,
  onSelectTarget,
  onConfigureCloud,
}: AutomationRunLocationSelectorProps) {
  const personalOption = ownerOptions.find((option) => option.value === "personal");
  const teamOption = ownerOptions.find((option) => option.value === "organization");
  const selectedPersonalRow = findSelectedTargetRow(personalGroups);
  const selectedTeamRow = findSelectedTargetRow(teamGroups);
  const personalDefaultRow = selectedPersonalRow ?? findDefaultTargetRow(personalGroups);
  const teamDefaultRow =
    selectedTeamRow
    ?? findDefaultTargetRow(teamGroups, "cloud")
    ?? findDefaultTargetRow(teamGroups);
  const selectedRow = ownerScope === "organization" ? selectedTeamRow : selectedPersonalRow;
  const teamDisabledReason =
    teamOption?.disabledReason
    ?? teamDefaultRow?.disabledReason
    ?? (teamDefaultRow ? null : "No shared team workspace configured.");
  const personalDisabledReason =
    personalOption?.disabledReason
    ?? (personalDefaultRow ? null : "No personal workspace target.");
  const triggerLabel = ownerScope === "organization"
    ? "Team"
    : selectedRow?.label ?? (isLoading ? "Loading targets" : "Personal");
  const triggerDetail = ownerScope === "organization"
    ? selectedRow?.repoLabel ?? "Shared workspace"
    : selectedRow?.repoLabel ?? null;
  const triggerIcon = ownerScope === "organization"
    ? selectedRow
      ? targetRowIcon(selectedRow, "trigger")
      : <CloudIcon className="size-3.5" />
    : selectedRow
    ? targetRowIcon(selectedRow, "trigger")
    : <FolderOpen className="size-3.5" />;
  const activeGroups = ownerScope === "organization" ? teamGroups : personalGroups;
  const activeOption = ownerScope === "organization" ? teamOption : personalOption;
  const activeOwnerDisabledReason = activeOption?.disabledReason ?? null;
  const activeEmptyLabel = ownerScope === "organization"
    ? disabledReason ?? "No shared team workspace configured."
    : disabledReason ?? "No personal workspace target.";
  const activeWorkspaceLabel = ownerScope === "organization"
    ? "Team workspace"
    : "Personal workspace";

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="shrink-0 text-sm text-muted-foreground">Run in</span>
        <PopoverButton
          trigger={(
            <PillControlButton
              icon={triggerIcon}
              label={triggerLabel}
              detail={triggerDetail}
              disclosure
              aria-label={`Run location: ${triggerLabel}${triggerDetail ? ` ${triggerDetail}` : ""}`}
              className="max-w-[22rem]"
              data-telemetry-mask
            />
          )}
          align="start"
          side="bottom"
          className={RUN_LOCATION_SURFACE_CLASS}
        >
          {(close) => (
            <div className="max-h-[min(22rem,calc(100vh-1rem))] min-h-0 overflow-y-auto">
              {canChangeOwner ? (
                <>
                  <RunLocationSectionHeader label="Run as" />
                  <RunLocationMenuItem
                    disabled={Boolean(personalDisabledReason)}
                    icon={<FolderOpen className="size-full" />}
                    label="Personal"
                    detail={personalDefaultRow?.label ?? "Your workspace"}
                    selected={ownerScope === "personal"}
                    title={personalDisabledReason ?? "Run with your local or personal cloud setup."}
                    onClick={() => {
                      if (personalDisabledReason) {
                        return;
                      }
                      onSelectOwner("personal");
                      if (personalDefaultRow) {
                        onSelectTarget(personalDefaultRow.target);
                      }
                    }}
                  />
                  <RunLocationMenuItem
                    disabled={Boolean(teamDisabledReason)}
                    icon={<CloudIcon className="size-full" />}
                    label="Team"
                    detail="Shared workspace"
                    selected={ownerScope === "organization"}
                    title={teamDisabledReason ?? "Run in the shared team workspace."}
                    onClick={() => {
                      if (teamDisabledReason) {
                        return;
                      }
                      onSelectOwner("organization");
                      if (teamDefaultRow) {
                        onSelectTarget(teamDefaultRow.target);
                      }
                    }}
                  />
                  <div className={RUN_LOCATION_DIVIDER_CLASS} />
                </>
              ) : null}
              {ownerScope === "personal" || ownerScope === "organization" ? (
                <>
                  <RunLocationSectionHeader label={canChangeOwner ? activeWorkspaceLabel : "Run in"} />
                  <RunLocationRows
                    activeOwnerScope={ownerScope}
                    disabledReason={activeOwnerDisabledReason}
                    emptyLabel={activeEmptyLabel}
                    groups={activeGroups}
                    isLoading={isLoading}
                    ownerScope={ownerScope}
                    onConfigureCloud={(target) => {
                      onConfigureCloud(target);
                      close();
                    }}
                    onSelectOwner={onSelectOwner}
                    onSelectTarget={(target) => {
                      onSelectTarget(target);
                      close();
                    }}
                  />
                </>
              ) : null}
            </div>
          )}
        </PopoverButton>
        {!canChangeOwner ? (
          <span className="shrink-0 text-xs text-muted-foreground">Scope locked</span>
        ) : null}
      </div>
      {disabledReason ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}

function RunLocationSectionHeader({ label }: { label: string }) {
  return (
    <div className={RUN_LOCATION_SECTION_CLASS}>
      {label}
    </div>
  );
}

function RunLocationRows({
  activeOwnerScope,
  disabledReason,
  emptyLabel,
  groups,
  isLoading,
  ownerScope,
  onSelectOwner,
  onSelectTarget,
  onConfigureCloud,
}: {
  activeOwnerScope: AutomationRunOwnerScope;
  disabledReason: string | null;
  emptyLabel: string;
  groups: AutomationTargetGroup[];
  isLoading: boolean;
  ownerScope: AutomationRunOwnerScope;
  onSelectOwner: (ownerScope: AutomationRunOwnerScope) => void;
  onSelectTarget: (target: AutomationTargetSelection) => void;
  onConfigureCloud: (target: {
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationRunOwnerScope;
  }) => void;
}) {
  if (isLoading) {
    return <RunLocationEmptyRow label="Loading targets" />;
  }

  const rows = groups.flatMap((group) => group.rows);
  if (rows.length === 0) {
    return <RunLocationEmptyRow label={emptyLabel} />;
  }

  return rows.map((row) => (
    <RunLocationMenuRow
      key={`${ownerScope}:${row.id}`}
      activeOwnerScope={activeOwnerScope}
      disabledReason={disabledReason}
      ownerScope={ownerScope}
      row={row}
      onSelectOwner={onSelectOwner}
      onSelectTarget={onSelectTarget}
      onConfigureCloud={onConfigureCloud}
    />
  ));
}

function RunLocationMenuRow({
  activeOwnerScope,
  disabledReason,
  ownerScope,
  row,
  onSelectOwner,
  onSelectTarget,
  onConfigureCloud,
}: {
  activeOwnerScope: AutomationRunOwnerScope;
  disabledReason: string | null;
  ownerScope: AutomationRunOwnerScope;
  row: AutomationTargetRow;
  onSelectOwner: (ownerScope: AutomationRunOwnerScope) => void;
  onSelectTarget: (target: AutomationTargetSelection) => void;
  onConfigureCloud: (target: {
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationRunOwnerScope;
  }) => void;
}) {
  if (row.kind === "configureCloud") {
    return (
      <RunLocationMenuItem
        disabled={Boolean(disabledReason)}
        icon={<Plus className="size-full" />}
        label="Set up cloud"
        detail={row.repoLabel}
        title={disabledReason ?? row.description ?? undefined}
        onClick={() => {
          if (disabledReason) {
            return;
          }
          onConfigureCloud({
            gitOwner: row.gitOwner,
            gitRepoName: row.gitRepoName,
            ownerScope,
          });
        }}
      />
    );
  }

  const rowDisabledReason = disabledReason ?? row.disabledReason;
  const selected = activeOwnerScope === ownerScope && row.selected;
  return (
    <RunLocationMenuItem
      disabled={Boolean(rowDisabledReason)}
      icon={targetRowIcon(row, "menu")}
      label={row.label}
      detail={row.repoLabel}
      selected={selected}
      title={rowDisabledReason ?? row.description ?? undefined}
      onClick={() => {
        if (rowDisabledReason) {
          return;
        }
        onSelectOwner(ownerScope);
        onSelectTarget(row.target);
      }}
    />
  );
}

function RunLocationMenuItem({
  detail,
  disabled = false,
  icon,
  label,
  onClick,
  selected = false,
  title,
}: {
  detail?: string | null;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  selected?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      className="group/menu-item flex w-full cursor-default select-none flex-col rounded-lg px-2 py-1 text-sm font-[430] leading-4 text-popover-foreground outline-none transition-colors hover:bg-popover-accent focus:bg-popover-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span className="flex w-full items-center gap-1.5">
        {icon ? (
          <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground opacity-75 transition-opacity group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100">
            {icon}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left">
          <span className="min-w-0 truncate">{label}</span>
          {detail ? (
            <span className="min-w-0 truncate text-muted-foreground">
              {detail}
            </span>
          ) : null}
        </span>
        {selected ? (
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground opacity-75 transition-opacity group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100">
            <Check className="size-3.5" />
          </span>
        ) : null}
      </span>
    </button>
  );
}

function RunLocationEmptyRow({ label }: { label: string }) {
  return (
    <div className="px-2 py-1 text-sm leading-4 text-muted-foreground">
      {label}
    </div>
  );
}

function targetRowIcon(
  row: Extract<AutomationTargetRow, { kind: "target" }>,
  variant: "menu" | "trigger",
) {
  if (row.computeTargetOption) {
    if (variant === "menu") {
      return <ComputeTargetSwatch appearance={row.computeTargetOption.appearance} size="inherit" />;
    }
    return (
      <span className="size-3.5">
        <ComputeTargetSwatch appearance={row.computeTargetOption.appearance} size="inherit" />
      </span>
    );
  }

  const iconClassName = variant === "menu" ? "size-full" : "size-3.5";
  if (row.target.executionTarget === "cloud") {
    return <CloudIcon className={iconClassName} />;
  }
  if (row.target.executionTarget === "ssh") {
    return <Terminal className={iconClassName} />;
  }
  return <FolderOpen className={iconClassName} />;
}

function findSelectedTargetRow(groups: AutomationTargetGroup[]) {
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.kind === "target" && row.selected) {
        return row;
      }
    }
  }
  return null;
}

function findDefaultTargetRow(
  groups: AutomationTargetGroup[],
  preferredExecutionTarget?: AutomationTargetSelection["executionTarget"],
) {
  let fallback: Extract<AutomationTargetRow, { kind: "target" }> | null = null;
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.kind !== "target") {
        continue;
      }
      if (!fallback && !row.disabledReason) {
        fallback = row;
      }
      if (
        preferredExecutionTarget
        && row.target.executionTarget === preferredExecutionTarget
        && !row.disabledReason
      ) {
        return row;
      }
    }
  }
  return fallback;
}
