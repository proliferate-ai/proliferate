import { PillControlButton } from "@proliferate/ui/primitives/PillControlButton";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import {
  CloudIcon,
  FolderOpen,
} from "@proliferate/ui/icons";
import type {
  AutomationTargetGroup,
  AutomationTargetSelection,
} from "@/lib/domain/automations/target/selection";
import {
  findDefaultAutomationTargetRow,
  findSelectedAutomationTargetRow,
  renderAutomationTargetRowIcon,
  RunLocationMenuItem,
  RunLocationRows,
  RunLocationSectionHeader,
  type AutomationRunLocationConfigureTarget,
  type AutomationRunOwnerScope,
} from "@/components/automations/controls/run-location/AutomationRunLocationMenu";

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
  onConfigureCloud: (target: AutomationRunLocationConfigureTarget) => void;
}

const RUN_LOCATION_SURFACE_CLASS = `w-72 min-w-[175px] ${POPOVER_SURFACE_CLASS}`;
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
  const selectedPersonalRow = findSelectedAutomationTargetRow(personalGroups);
  const selectedTeamRow = findSelectedAutomationTargetRow(teamGroups);
  const personalDefaultRow = selectedPersonalRow ?? findDefaultAutomationTargetRow(personalGroups);
  const teamDefaultRow =
    selectedTeamRow
    ?? findDefaultAutomationTargetRow(teamGroups, "cloud")
    ?? findDefaultAutomationTargetRow(teamGroups);
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
      ? renderAutomationTargetRowIcon(selectedRow, "trigger")
      : <CloudIcon className="size-3.5" />
    : selectedRow
    ? renderAutomationTargetRowIcon(selectedRow, "trigger")
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
