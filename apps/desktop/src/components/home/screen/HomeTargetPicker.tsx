import { useState } from "react";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  PickerEmptyRow,
  PickerPopoverContent,
} from "@proliferate/ui/primitives/PickerPopoverContent";
import { PillControlButton } from "@proliferate/ui/primitives/PillControlButton";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import {
  Check,
  ChevronRight,
  FolderPlus,
  GitBranchIcon,
  Sparkles,
  X,
} from "@proliferate/ui/icons";
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
  ProjectSearchField,
  TARGET_PICKER_DIVIDER_CLASS,
  TARGET_PICKER_SURFACE_CLASS,
  TargetPickerMenuItem,
  TargetSection,
} from "@/components/home/screen/HomeTargetPickerParts";

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
  const [projectSearchValue, setProjectSearchValue] = useState("");
  const [runtimeSearchValue, setRuntimeSearchValue] = useState("");
  const filteredRepositories = repositories.filter((repository) =>
    matchesPickerSearch([repository.name, repository.sourceRoot], projectSearchValue)
  );
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
    setProjectSearchValue("");
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
    <PillControlButton
      icon={homeTargetLaunchKindIcon(repoLaunchKind, selectedSshTarget)}
      label={destination === "cowork" ? "No repository" : runtimeLabel}
      disabled={!selectedRepository || destination === "cowork"}
      disclosure={!!selectedRepository && destination === "repository"}
      aria-label={homeTargetRuntimeAriaLabel({
        label: runtimeLabel,
        selectedRepository,
        destination,
      })}
      className="max-w-[13rem]"
    />
  );

  return (
    <>
      <PopoverButton
        trigger={(
          <PillControlButton
            icon={destination === "cowork" ? <Sparkles className="size-3.5" /> : null}
            label={homeTargetProjectLabel({ destination, selectedRepository })}
            disclosure
            aria-label={homeTargetProjectAriaLabel({ destination, selectedRepository })}
            className="max-w-[14rem]"
          />
        )}
        side="top"
        className="w-[23rem] rounded-xl border border-border bg-popover p-1 shadow-floating"
      >
        {(close) => (
          <div className="flex max-h-[20rem] min-h-0 flex-col">
            <ProjectSearchField
              value={projectSearchValue}
              onChange={setProjectSearchValue}
            />
            <div className="min-h-0 overflow-y-auto py-1">
              {filteredRepositories.map((repository) => {
                const isSelected =
                  destination === "repository"
                  && selectedRepository?.sourceRoot === repository.sourceRoot;
                return (
                  <PopoverMenuItem
                    key={repository.sourceRoot}
                    label={repository.name}
                    trailing={isSelected ? <Check className="size-4" /> : null}
                    className="rounded-lg px-3 py-1.5 text-sm"
                    onClick={() => {
                      onSelectRepository(repository.sourceRoot);
                      clearSearch();
                      close();
                    }}
                  />
                );
              })}
              {filteredRepositories.length === 0 ? (
                <PickerEmptyRow label="No projects found" />
              ) : null}
            </div>

            <div className="mx-2.5 my-1 border-t border-border/70" />
            <div className="pb-1">
              <PopoverMenuItem
                icon={<FolderPlus className="size-3.5" />}
                label="Add new project"
                trailing={<ChevronRight className="size-3.5" />}
                className="rounded-lg px-2.5 py-1.5 text-sm"
                onClick={() => {
                  onAddRepository();
                  clearSearch();
                  close();
                }}
              />
              <PopoverMenuItem
                icon={<X className="size-3.5" />}
                label="Don't work in a project"
                trailing={destination === "cowork" ? <Check className="size-3.5" /> : null}
                className="rounded-lg px-2.5 py-1.5 text-sm"
                onClick={() => {
                  onSelectCowork();
                  clearSearch();
                  close();
                }}
              />
            </div>
          </div>
        )}
      </PopoverButton>

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
                  return (
                    <TargetPickerMenuItem
                      key={`ssh:${target.id}`}
                      icon={homeTargetLaunchKindIcon("ssh", target, "menu")}
                      label={target.label}
                      disabled={target.disabledReason !== null}
                      title={target.disabledReason ?? undefined}
                      trailing={isSelected ? <Check className="size-3.5" /> : null}
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
            <PillControlButton
              icon={<GitBranchIcon className="size-3.5" />}
              label={selectedBranchName ?? "Base branch"}
              disclosure
              aria-label={`Branch: ${selectedBranchName ?? "base branch"}`}
              className="max-w-[15rem]"
            />
          )}
          side="top"
          className="w-[22rem] rounded-xl border border-border bg-popover p-1 shadow-floating"
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
