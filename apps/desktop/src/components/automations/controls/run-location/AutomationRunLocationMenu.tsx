import type { ReactNode } from "react";
import { ComputeTargetSwatch } from "@/components/compute/ComputeTargetSwatch";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  Check,
  CloudIcon,
  FolderOpen,
  Plus,
  Terminal,
} from "@proliferate/ui/icons";
import type {
  AutomationTargetGroup,
  AutomationTargetRow,
  AutomationTargetSelection,
} from "@/lib/domain/automations/target/selection";

export type AutomationRunOwnerScope = "personal" | "organization";

export interface AutomationRunLocationConfigureTarget {
  gitOwner: string;
  gitRepoName: string;
  ownerScope: AutomationRunOwnerScope;
}

const RUN_LOCATION_SECTION_CLASS =
  "flex min-h-6 items-center truncate px-2 py-1 text-sm leading-4 text-muted-foreground";

export function RunLocationSectionHeader({ label }: { label: string }) {
  return (
    <div className={RUN_LOCATION_SECTION_CLASS}>
      {label}
    </div>
  );
}

export function RunLocationRows({
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
  onConfigureCloud: (target: AutomationRunLocationConfigureTarget) => void;
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

export function renderAutomationTargetRowIcon(
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

export function findSelectedAutomationTargetRow(groups: AutomationTargetGroup[]) {
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.kind === "target" && row.selected) {
        return row;
      }
    }
  }
  return null;
}

export function findDefaultAutomationTargetRow(
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
  onConfigureCloud: (target: AutomationRunLocationConfigureTarget) => void;
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
      icon={renderAutomationTargetRowIcon(row, "menu")}
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

export function RunLocationMenuItem({
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
    <PopoverMenuItem
      density="compact"
      disabled={disabled}
      title={title}
      icon={icon}
      label={(
        <>
          <span className="min-w-0 truncate">{label}</span>
          {detail ? (
            <span className="min-w-0 truncate text-muted-foreground">
              {detail}
            </span>
          ) : null}
        </>
      )}
      labelClassName="flex items-baseline gap-1.5 text-left"
      trailing={selected ? <Check className="size-3.5" /> : null}
      onClick={() => {
        onClick();
      }}
    />
  );
}

function RunLocationEmptyRow({ label }: { label: string }) {
  return (
    <div className="px-2 py-1 text-sm leading-4 text-muted-foreground">
      {label}
    </div>
  );
}
