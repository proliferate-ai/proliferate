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
  onSelectCowork: () => void;
  onSelectRepository: (sourceRoot: string) => void;
  onSelectRuntime: (launchKind: HomeNextRepoLaunchKind) => void;
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
  // only local / worktree, never cloud and never empty.
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
  const clearSearch = () => {
    setRuntimeSearchValue("");
  };
  const runtimeLabel = effectiveRepoLaunchKind === "cloud"
    ? homeTargetRuntimeOptionLabel({
      launchKind: effectiveRepoLaunchKind,
      cloudAction: selectedRepositoryCloudAction,
    })
    : homeRepoLaunchKindLabel(effectiveRepoLaunchKind);
  const runtimeButton = (
    <HomeTargetRowItem
      icon={homeTargetLaunchKindIcon(effectiveRepoLaunchKind)}
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
                    icon={homeTargetLaunchKindIcon(launchKind, "menu")}
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
