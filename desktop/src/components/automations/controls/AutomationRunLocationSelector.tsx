import type { AutomationOwnerScope } from "@/lib/access/cloud/client";
import { SelectionRow } from "@/components/ui/SelectionRow";
import {
  CloudIcon,
  FolderOpen,
  Plus,
} from "@/components/ui/icons";
import type {
  AutomationTargetGroup,
  AutomationTargetRow,
  AutomationTargetSelection,
} from "@/lib/domain/automations/target/selection";

interface AutomationOwnerOption {
  value: AutomationOwnerScope;
  label: string;
  description: string;
  disabledReason?: string | null;
}

interface AutomationRunLocationSelectorProps {
  ownerScope: AutomationOwnerScope;
  canChangeOwner: boolean;
  ownerOptions: AutomationOwnerOption[];
  personalGroups: AutomationTargetGroup[];
  teamGroups: AutomationTargetGroup[];
  isLoading: boolean;
  disabledReason: string | null;
  onSelectOwner: (ownerScope: AutomationOwnerScope) => void;
  onSelectTarget: (target: AutomationTargetSelection) => void;
  onConfigureCloud: (target: { gitOwner: string; gitRepoName: string }) => void;
}

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
  const visibleSections = canChangeOwner
    ? ([
      {
        option: personalOption,
        groups: personalGroups,
        ownerScope: "personal" as const,
        emptyLabel: disabledReason ?? "No local or personal cloud targets found.",
      },
      {
        option: teamOption,
        groups: teamGroups,
        ownerScope: "organization" as const,
        emptyLabel: teamOption?.disabledReason ?? "No shared cloud workspace configured.",
      },
    ]).filter((section) => section.option)
    : ([
      {
        option: ownerScope === "organization" ? teamOption : personalOption,
        groups: ownerScope === "organization" ? teamGroups : personalGroups,
        ownerScope,
        emptyLabel: disabledReason ?? "No target available.",
      },
    ]).filter((section) => section.option);

  return (
    <section className="rounded-lg border border-border bg-foreground/[0.03] p-3">
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Run location</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose where this automation runs.
          </p>
        </div>
        {!canChangeOwner ? (
          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            Scope locked
          </span>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {visibleSections.map((section) => (
          <RunLocationSection
            key={section.ownerScope}
            title={section.option?.label ?? "Location"}
            description={section.option?.description ?? ""}
            ownerScope={section.ownerScope}
            activeOwnerScope={ownerScope}
            groups={section.groups}
            isLoading={isLoading}
            disabledReason={section.option?.disabledReason ?? null}
            emptyLabel={section.emptyLabel}
            onSelectOwner={onSelectOwner}
            onSelectTarget={onSelectTarget}
            onConfigureCloud={onConfigureCloud}
          />
        ))}
      </div>
    </section>
  );
}

interface RunLocationSectionProps {
  title: string;
  description: string;
  ownerScope: AutomationOwnerScope;
  activeOwnerScope: AutomationOwnerScope;
  groups: AutomationTargetGroup[];
  isLoading: boolean;
  disabledReason: string | null;
  emptyLabel: string;
  onSelectOwner: (ownerScope: AutomationOwnerScope) => void;
  onSelectTarget: (target: AutomationTargetSelection) => void;
  onConfigureCloud: (target: { gitOwner: string; gitRepoName: string }) => void;
}

function RunLocationSection({
  title,
  description,
  ownerScope,
  activeOwnerScope,
  groups,
  isLoading,
  disabledReason,
  emptyLabel,
  onSelectOwner,
  onSelectTarget,
  onConfigureCloud,
}: RunLocationSectionProps) {
  const sectionDisabled = Boolean(disabledReason);
  const hasRows = groups.some((group) => group.rows.length > 0);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-start gap-2">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
          {ownerScope === "organization"
            ? <CloudIcon className="size-4" />
            : <FolderOpen className="size-4" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {title}
          </span>
          <span className="block text-xs text-muted-foreground">
            {disabledReason ?? description}
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {isLoading ? (
          <LocationPlaceholder label="Loading targets..." />
        ) : hasRows ? (
          groups.map((group) => (
            <div key={`${ownerScope}:${group.repoKey}`} className="flex flex-col gap-1.5">
              {group.rows.map((row) => (
                <RunLocationRow
                  key={`${ownerScope}:${row.id}`}
                  row={row}
                  ownerScope={ownerScope}
                  activeOwnerScope={activeOwnerScope}
                  sectionDisabled={sectionDisabled}
                  sectionDisabledReason={disabledReason}
                  onSelectOwner={onSelectOwner}
                  onSelectTarget={onSelectTarget}
                  onConfigureCloud={onConfigureCloud}
                />
              ))}
            </div>
          ))
        ) : (
          <LocationPlaceholder label={emptyLabel} />
        )}
      </div>
    </div>
  );
}

interface RunLocationRowProps {
  row: AutomationTargetRow;
  ownerScope: AutomationOwnerScope;
  activeOwnerScope: AutomationOwnerScope;
  sectionDisabled: boolean;
  sectionDisabledReason: string | null;
  onSelectOwner: (ownerScope: AutomationOwnerScope) => void;
  onSelectTarget: (target: AutomationTargetSelection) => void;
  onConfigureCloud: (target: { gitOwner: string; gitRepoName: string }) => void;
}

function RunLocationRow({
  row,
  ownerScope,
  activeOwnerScope,
  sectionDisabled,
  sectionDisabledReason,
  onSelectOwner,
  onSelectTarget,
  onConfigureCloud,
}: RunLocationRowProps) {
  if (row.kind === "configureCloud") {
    return (
      <SelectionRow
        selected={false}
        disabled={sectionDisabled}
        title={sectionDisabledReason ?? undefined}
        icon={<Plus className="size-4 text-muted-foreground" />}
        label={row.label}
        subtitle={[
          row.repoLabel,
          sectionDisabledReason ?? row.description,
        ].filter(Boolean).join(" - ")}
        onClick={() => {
          if (sectionDisabled) {
            return;
          }
          onConfigureCloud({
            gitOwner: row.gitOwner,
            gitRepoName: row.gitRepoName,
          });
        }}
      />
    );
  }

  const disabledReason = sectionDisabledReason ?? row.disabledReason;
  const disabled = Boolean(disabledReason);
  const selected = activeOwnerScope === ownerScope && row.selected;
  return (
    <SelectionRow
      selected={selected}
      disabled={disabled}
      title={disabledReason ?? undefined}
      icon={row.target.executionTarget === "cloud"
        ? <CloudIcon className="size-4 text-muted-foreground" />
        : <FolderOpen className="size-4 text-muted-foreground" />}
      label={row.repoLabel}
      subtitle={[row.label, disabledReason ?? row.description].filter(Boolean).join(" - ")}
      onClick={() => {
        if (disabled) {
          return;
        }
        onSelectOwner(ownerScope);
        onSelectTarget(row.target);
      }}
    />
  );
}

function LocationPlaceholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
