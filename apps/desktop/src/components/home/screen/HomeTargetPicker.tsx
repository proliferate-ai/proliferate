import { useState } from "react";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  PickerEmptyRow,
  PickerPopoverContent,
} from "@proliferate/ui/primitives/PickerPopoverContent";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import {
  Check,
  ProjectNotebook,
  GitBranchIcon,
} from "@proliferate/ui/icons";
import { DirectRuntimeAttachDot } from "@/components/compute/DirectRuntimeAttachChip";
import { matchesPickerSearch } from "@proliferate/ui/utils/search";
import type { ComputeLaunchTargetOption } from "@/lib/domain/compute/target-options";
import type {
  HomeNextDestination,
  HomeNextRepoLaunchKind,
} from "@/lib/domain/home/home-next-launch";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import type { CloudRepoActionState } from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import {
  homeRepoLaunchKindLabel,
  homeTargetProjectAriaLabel,
  homeTargetProjectLabel,
  homeTargetRuntimeAriaLabel,
  homeTargetRuntimeOptionLabel,
} from "@/lib/domain/home/home-target-picker";
import {
  BranchSearchField,
  homeTargetLaunchKindIcon,
  HomeTargetRowItem,
  TARGET_PICKER_DIVIDER_CLASS,
  TARGET_PICKER_SURFACE_CLASS,
  TargetPickerMenuItem,
  TargetSection,
} from "@/components/home/screen/HomeTargetPickerParts";
import { HomeProjectMenu } from "@/components/home/screen/HomeProjectMenu";

interface HomeTargetPickerProps {
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
  onAddRepository: () => void;
  onConfigureCloud: (repository: SettingsRepositoryEntry) => void;
}

export function HomeTargetPicker({
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
  onAddRepository,
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
  const selectedSshTarget =
    sshTargetOptions.find((target) => target.id === selectedSshTargetId) ?? null;
  const filteredSshTargetOptions = sshTargetOptions;
  const clearSearch = () => {
    setRuntimeSearchValue("");
  };
  const runtimeLabel = repoLaunchKind === "ssh"
    ? selectedSshTarget?.label ?? homeRepoLaunchKindLabel(repoLaunchKind)
    : repoLaunchKind === "cloud"
    ? homeTargetRuntimeOptionLabel({
      launchKind: repoLaunchKind,
      cloudAction: selectedRepositoryCloudAction,
    })
    : homeRepoLaunchKindLabel(repoLaunchKind);
  const runtimeButton = (
    <HomeTargetRowItem
      icon={homeTargetLaunchKindIcon(repoLaunchKind, selectedSshTarget)}
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
            icon={<ProjectNotebook className="size-4" />}
            value={homeTargetProjectLabel({ destination, selectedRepository })}
            disclosure={false}
            aria-label={homeTargetProjectAriaLabel({ destination, selectedRepository })}
          />
        )}
        destination={destination}
        repositories={repositories}
        selectedRepository={selectedRepository}
        onSelectRepository={onSelectRepository}
        onSelectCowork={onSelectCowork}
        onAddRepository={onAddRepository}
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
              {(["local", "worktree", "cloud"] as const).map((launchKind) => {
                const isSelected = repoLaunchKind === launchKind;
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
                    trailing={isSelected ? <Check className="size-3.5" /> : null}
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
              {sshTargetsLoading || filteredSshTargetOptions.length > 0 ? (
                <div className={TARGET_PICKER_DIVIDER_CLASS} />
              ) : null}
              {sshTargetsLoading ? (
                <PickerEmptyRow label="Loading targets" />
              ) : filteredSshTargetOptions.length > 0 ? (
                filteredSshTargetOptions.map((target) => {
                  const isSelected = repoLaunchKind === "ssh" && selectedSshTargetId === target.id;
                  const attachDot = target.attachState
                    ? <DirectRuntimeAttachDot state={target.attachState} />
                    : null;
                  return (
                    <TargetPickerMenuItem
                      key={`ssh:${target.id}`}
                      icon={homeTargetLaunchKindIcon("ssh", target, "menu")}
                      label={target.label}
                      disabled={target.disabledReason !== null}
                      title={target.disabledReason ?? undefined}
                      trailing={attachDot || isSelected ? (
                        <span className="flex items-center gap-1.5">
                          {attachDot}
                          {isSelected ? <Check className="size-3.5" /> : null}
                        </span>
                      ) : null}
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
              icon={<GitBranchIcon className="size-3.5" />}
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
                    icon={<GitBranchIcon className="size-3.5" />}
                    label={branch}
                    trailing={selectedBranchName === branch ? <Check className="size-3.5" /> : null}
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
