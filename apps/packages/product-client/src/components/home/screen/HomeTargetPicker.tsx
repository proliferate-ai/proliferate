import { useState } from "react";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import {
  PickerEmptyRow,
  PickerPopoverContent,
} from "#product/primitives/patterns/PickerPopoverContent";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { Check } from "#product/primitives/icons/core";
import { ProjectNotebook } from "#product/primitives/icons/workspace";
import { GitBranchIcon } from "#product/primitives/icons/workspace-git";
import { matchesPickerSearch } from "#product/primitives/utils/search";
import type { ComputeLaunchTargetOption } from "#product/lib/domain/compute/target-options";
import type {
  HomeNextDestination,
  HomeNextRepoLaunchKind,
} from "#product/lib/domain/home/home-next-launch";
import type { SettingsRepositoryEntry } from "#product/lib/domain/settings/repositories";
import type { CloudRepoActionState } from "#product/lib/domain/workspaces/cloud/cloud-workspace-creation";
import {
  homeRepoLaunchKindLabel,
  homeTargetProjectAriaLabel,
  homeTargetProjectLabel,
  homeTargetRuntimeAriaLabel,
  homeTargetRuntimeOptionLabel,
} from "#product/lib/domain/home/home-target-picker";
import {
  BranchSearchField,
  homeTargetLaunchKindIcon,
  HomeTargetRowItem,
  TARGET_PICKER_DIVIDER_CLASS,
  TARGET_PICKER_SURFACE_CLASS,
  TargetPickerMenuItem,
  TargetSection,
} from "#product/components/home/screen/HomeTargetPickerParts";
import { HomeProjectMenu } from "#product/components/home/screen/HomeProjectMenu";

interface HomeTargetPickerProps {
  desktopTargetsAvailable: boolean;
  destination: HomeNextDestination;
  repoLaunchKind: HomeNextRepoLaunchKind;
  repositories: SettingsRepositoryEntry[];
  selectedRepository: SettingsRepositoryEntry | null;
  selectedBranchName: string | null;
  branchOptions: string[];
  branchLoading: boolean;
  cloudActionBySourceRoot: Record<string, CloudRepoActionState>;
  sshTargetOptions: ComputeLaunchTargetOption[];
  selectedSshTargetId: string | null;
  sshTargetsLoading: boolean;
  onSelectCowork: () => void;
  onSelectRepository: (sourceRoot: string) => void;
  onSelectRuntime: (launchKind: HomeNextRepoLaunchKind, targetId?: string | null) => void;
  onSelectBranch: (branchName: string) => void;
  onConfigureCloud: (repository: SettingsRepositoryEntry) => void;
}

export function HomeTargetPicker({
  desktopTargetsAvailable,
  destination,
  repoLaunchKind,
  repositories,
  selectedRepository,
  selectedBranchName,
  branchOptions,
  branchLoading,
  cloudActionBySourceRoot,
  sshTargetOptions,
  selectedSshTargetId,
  sshTargetsLoading,
  onSelectCowork,
  onSelectRepository,
  onSelectRuntime,
  onSelectBranch,
  onConfigureCloud,
}: HomeTargetPickerProps) {
  const [runtimeSearchValue, setRuntimeSearchValue] = useState("");
  const filteredBranches = branchOptions.filter((branch) =>
    matchesPickerSearch([branch], runtimeSearchValue)
  );
  const isRepositoryTarget = destination === "repository" && !!selectedRepository;
  const canShowBranchChoices = isRepositoryTarget;
  const selectedRepositoryCloudAction: CloudRepoActionState = selectedRepository
    ? cloudActionBySourceRoot[selectedRepository.sourceRoot] ?? { kind: "hidden", label: null }
    : { kind: "hidden", label: null };
  // Cloud compute is culled from Desktop (PRO-10): the Desktop picker offers
  // only local / worktree (+ SSH targets below), never cloud and never empty.
  // Web keeps its cloud offering, gated by `desktopTargetsAvailable` (the host
  // capability), not by a deleted branch. `repoLaunchKind` is normalized to a
  // desktop-valid value at the selection source
  // (normalizeDesktopTargetAvailability in
  // use-home-next-target-selection-state.ts), so a "cloud" value should never
  // reach here from that path; this coercion is kept as a display-only
  // defense in depth for any caller that renders the picker directly with a
  // stale prop.
  const effectiveRepoLaunchKind = desktopTargetsAvailable
    ? (repoLaunchKind === "cloud" ? "worktree" : repoLaunchKind)
    : "cloud";
  const runtimeLaunchKinds: readonly HomeNextRepoLaunchKind[] = desktopTargetsAvailable
    ? ["local", "worktree"]
    : ["cloud"];
  const selectedSshTarget = desktopTargetsAvailable
    ? sshTargetOptions.find((target) => target.id === selectedSshTargetId) ?? null
    : null;
  const filteredSshTargetOptions = sshTargetOptions;
  const clearSearch = () => {
    setRuntimeSearchValue("");
  };
  const runtimeLabel = effectiveRepoLaunchKind === "ssh"
    ? selectedSshTarget?.label ?? homeRepoLaunchKindLabel(effectiveRepoLaunchKind)
    : effectiveRepoLaunchKind === "cloud"
    ? homeTargetRuntimeOptionLabel({
      launchKind: effectiveRepoLaunchKind,
      cloudAction: selectedRepositoryCloudAction,
    })
    : homeRepoLaunchKindLabel(effectiveRepoLaunchKind);
  const runtimeButton = (
    <HomeTargetRowItem
      icon={homeTargetLaunchKindIcon(effectiveRepoLaunchKind, selectedSshTarget)}
      value={destination === "cowork" ? "No repository" : runtimeLabel}
      disabled={!selectedRepository || destination === "cowork"}
      disclosure={!!selectedRepository && destination === "repository"}
      aria-label={homeTargetRuntimeAriaLabel({
        label: runtimeLabel,
        selectedRepository,
        destination,
      })}
    />
  );

  return (
    <>
      <HomeProjectMenu
        trigger={(
          <HomeTargetRowItem
            icon={<ProjectNotebook className="icon-paired" />}
            value={homeTargetProjectLabel({ destination, selectedRepository })}
            aria-label={homeTargetProjectAriaLabel({ destination, selectedRepository })}
          />
        )}
        coworkAvailable={desktopTargetsAvailable}
        destination={destination}
        repositories={repositories}
        selectedRepository={selectedRepository}
        onSelectRepository={onSelectRepository}
        onSelectCowork={onSelectCowork}
      />

      {selectedRepository && destination === "repository" ? (
        <PopoverButton
          trigger={runtimeButton}
          side="top"
          className={TARGET_PICKER_SURFACE_CLASS}
        >
          {(close) => (
            // `py-0` only started winning when PickerPopoverContent moved from
            // concatenating its className to merging it: under the old join the
            // pattern's own `py-1` sat later in the generated stylesheet, so this
            // body shipped with the 4px block padding it had asked not to have.
            // The divider between the runtime and SSH sections is meant to run
            // flush to the body's edges, which is what the override was for.
            <PickerPopoverContent
              className="max-h-[min(20rem,calc(100vh-1rem))]"
              bodyClassName="py-0"
            >
              {runtimeLaunchKinds.map((launchKind) => {
                const isSelected = effectiveRepoLaunchKind === launchKind;
                const cloudConfigure =
                  launchKind === "cloud" && selectedRepositoryCloudAction.kind === "configure";
                const cloudLoading =
                  launchKind === "cloud" && selectedRepositoryCloudAction.kind === "loading";
                const cloudHidden =
                  launchKind === "cloud" && selectedRepositoryCloudAction.kind === "hidden";
                return (
                  <TargetPickerMenuItem
                    key={launchKind}
                    icon={homeTargetLaunchKindIcon(launchKind, null, "menu")}
                    label={homeTargetRuntimeOptionLabel({
                      launchKind,
                      cloudAction: selectedRepositoryCloudAction,
                    })}
                    disabled={cloudLoading || cloudHidden}
                    trailing={isSelected ? <Check className="icon-paired" /> : null}
                    onClick={() => {
                      if (cloudConfigure) {
                        onConfigureCloud(selectedRepository);
                        clearSearch();
                        close();
                        return;
                      }
                      onSelectRuntime(launchKind);
                      clearSearch();
                      close();
                    }}
                  />
                );
              })}
              {desktopTargetsAvailable
                && (sshTargetsLoading || filteredSshTargetOptions.length > 0) ? (
                <div className={TARGET_PICKER_DIVIDER_CLASS} />
              ) : null}
              {desktopTargetsAvailable && sshTargetsLoading ? (
                <PickerEmptyRow label="Loading targets" />
              ) : desktopTargetsAvailable && filteredSshTargetOptions.length > 0 ? (
                filteredSshTargetOptions.map((target) => {
                  const isSelected =
                    effectiveRepoLaunchKind === "ssh"
                    && selectedSshTargetId === target.id;
                  return (
                    <TargetPickerMenuItem
                      key={`ssh:${target.id}`}
                      icon={homeTargetLaunchKindIcon("ssh", target, "menu")}
                      label={target.label}
                      disabled={target.disabledReason !== null}
                      title={target.disabledReason ?? undefined}
                      trailing={isSelected ? <Check className="icon-paired" /> : null}
                      onClick={() => {
                        onSelectRuntime("ssh", target.id);
                        clearSearch();
                        close();
                      }}
                    />
                  );
                })
              ) : null}
            </PickerPopoverContent>
          )}
        </PopoverButton>
      ) : null}

      {selectedRepository && destination === "repository" && canShowBranchChoices ? (
        <PopoverButton
          trigger={(
            <HomeTargetRowItem
              icon={<GitBranchIcon className="icon-paired" />}
              value={selectedBranchName ?? "base branch"}
              aria-label={`Branch: ${selectedBranchName ?? "base branch"}`}
            />
          )}
          side="top"
          className={`w-72 min-w-[175px] ${POPOVER_SURFACE_CLASS}`}
        >
          {(close) => (
            <PickerPopoverContent>
              <TargetSection label="Base branch" />
              <BranchSearchField
                value={runtimeSearchValue}
                onChange={setRuntimeSearchValue}
              />
              {branchLoading ? (
                <PickerEmptyRow label="Loading branches" />
              ) : filteredBranches.length > 0 ? (
                filteredBranches.map((branch) => (
                  <PopoverMenuItem
                    key={branch}
                    icon={<GitBranchIcon className="icon-paired" />}
                    label={branch}
                    trailing={selectedBranchName === branch ? <Check className="icon-paired" /> : null}
                    onClick={() => {
                      onSelectBranch(branch);
                      clearSearch();
                      close();
                    }}
                  />
                ))
              ) : (
                <PickerEmptyRow label="No branches found" />
              )}
            </PickerPopoverContent>
          )}
        </PopoverButton>
      ) : null}
      {!selectedRepository && destination === "repository" ? runtimeButton : null}
    </>
  );
}
