import { useState } from "react";
import { Input } from "@proliferate/ui/primitives/Input";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import {
  PickerEmptyRow,
  PickerPopoverContent,
} from "@/components/ui/PickerPopoverContent";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  Check,
  ChevronRight,
  CloudIcon,
  Folder,
  FolderPlus,
  GitBranchIcon,
  Monitor,
  Search,
  Sparkles,
  X,
} from "@/components/ui/icons";
import { matchesPickerSearch } from "@/lib/infra/search/search";
import type {
  HomeNextDestination,
  HomeNextRepoLaunchKind,
} from "@/lib/domain/home/home-next-launch";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import type { CloudRepoActionState } from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";

interface HomeTargetPickerProps {
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
  onAddRepository: () => void;
  onConfigureCloud: (repository: SettingsRepositoryEntry) => void;
}

function launchKindLabel(kind: HomeNextRepoLaunchKind): string {
  switch (kind) {
    case "worktree":
      return "New worktree";
    case "local":
      return "Work locally";
    case "cloud":
      return "Cloud workspace";
  }
}

function launchKindIcon(kind: HomeNextRepoLaunchKind) {
  switch (kind) {
    case "worktree":
      return <GitBranchIcon className="size-3.5" />;
    case "local":
      return <Monitor className="size-3.5" />;
    case "cloud":
      return <CloudIcon className="size-3.5" />;
  }
}

function projectLabel(input: {
  destination: HomeNextDestination;
  selectedRepository: SettingsRepositoryEntry | null;
}): string {
  if (input.destination === "cowork") {
    return "No project";
  }
  return input.selectedRepository?.name ?? "Choose repository";
}

function TargetSection({ label }: { label: string }) {
  return (
    <div className="px-3 pb-1.5 pt-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
      {label}
    </div>
  );
}

function targetRowSubtext(input: {
  repository: SettingsRepositoryEntry;
  launchKind: HomeNextRepoLaunchKind;
  selectedBranchName: string | null;
}): string {
  if (input.launchKind === "local") {
    return `${input.repository.name} · existing checkout`;
  }

  return `${input.repository.name} · ${input.selectedBranchName ?? "default branch"}`;
}

function runtimeOptionLabel(input: {
  launchKind: HomeNextRepoLaunchKind;
  cloudAction: CloudRepoActionState;
}): string {
  if (input.launchKind !== "cloud") {
    return launchKindLabel(input.launchKind);
  }
  if (input.cloudAction.kind === "loading") {
    return input.cloudAction.label;
  }
  if (input.cloudAction.kind === "configure") {
    return "Configure cloud workspace";
  }
  if (input.cloudAction.kind === "hidden") {
    return "Cloud unavailable";
  }
  return launchKindLabel(input.launchKind);
}

function projectAriaLabel(input: {
  destination: HomeNextDestination;
  selectedRepository: SettingsRepositoryEntry | null;
}): string {
  if (input.destination === "cowork") {
    return "Project: No project";
  }
  return input.selectedRepository
    ? `Project: ${input.selectedRepository.name} repository`
    : "Project: Choose repository";
}

function ProjectSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="p-2 pb-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface-control px-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search projects"
          className="h-8 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
        />
      </div>
    </div>
  );
}

function runtimeAriaLabel(input: {
  label: string;
  selectedRepository: SettingsRepositoryEntry | null;
  destination: HomeNextDestination;
}): string {
  if (!input.selectedRepository || input.destination === "cowork") {
    return "Runtime: no repository selected";
  }
  return `Runtime: ${input.label}`;
}

function BranchSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="px-1 pb-1">
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface-control px-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search branches"
          className="h-8 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
        />
      </div>
    </div>
  );
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
  const clearSearch = () => {
    setProjectSearchValue("");
    setRuntimeSearchValue("");
  };
  const runtimeLabel = repoLaunchKind === "cloud"
    ? runtimeOptionLabel({
      launchKind: repoLaunchKind,
      cloudAction: selectedRepositoryCloudAction,
    })
    : launchKindLabel(repoLaunchKind);
  const runtimeButton = (
    <PillControlButton
      icon={launchKindIcon(repoLaunchKind)}
      label={destination === "cowork" ? "No repository" : runtimeLabel}
      disabled={!selectedRepository || destination === "cowork"}
      disclosure={!!selectedRepository && destination === "repository"}
      aria-label={runtimeAriaLabel({
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
            icon={destination === "cowork"
              ? <Sparkles className="size-3.5" />
              : <Folder className="size-3.5" />}
            label={projectLabel({ destination, selectedRepository })}
            disclosure
            aria-label={projectAriaLabel({ destination, selectedRepository })}
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
          className="w-[22rem] rounded-xl border border-border bg-popover p-1 shadow-floating"
        >
          {(close) => (
            <PickerPopoverContent>
              <TargetSection label="Run in" />
              {(["worktree", "local", "cloud"] as const).map((launchKind) => {
                const isSelected = repoLaunchKind === launchKind;
                const cloudConfigure =
                  launchKind === "cloud" && selectedRepositoryCloudAction.kind === "configure";
                const cloudLoading =
                  launchKind === "cloud" && selectedRepositoryCloudAction.kind === "loading";
                const cloudHidden =
                  launchKind === "cloud" && selectedRepositoryCloudAction.kind === "hidden";
                return (
                  <PopoverMenuItem
                    key={launchKind}
                    icon={launchKindIcon(launchKind)}
                    label={runtimeOptionLabel({
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
                  >
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
                      {targetRowSubtext({
                        repository: selectedRepository,
                        launchKind,
                        selectedBranchName,
                      })}
                    </span>
                  </PopoverMenuItem>
                );
              })}
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
