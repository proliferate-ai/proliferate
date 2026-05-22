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
  CloudIcon,
  FolderOpen,
  GitBranchIcon,
  Plus,
  Search,
  Sparkles,
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
      return "Local checkout";
    case "cloud":
      return "Cloud workspace";
  }
}

function launchKindIcon(kind: HomeNextRepoLaunchKind) {
  switch (kind) {
    case "worktree":
      return <GitBranchIcon className="size-3.5" />;
    case "local":
      return <FolderOpen className="size-3.5" />;
    case "cloud":
      return <CloudIcon className="size-3.5" />;
  }
}

function launchKindDetail(kind: HomeNextRepoLaunchKind): string {
  switch (kind) {
    case "worktree":
      return "new worktree";
    case "local":
      return "existing checkout";
    case "cloud":
      return "personal cloud";
  }
}

function projectLabel(input: {
  destination: HomeNextDestination;
  selectedRepository: SettingsRepositoryEntry | null;
}): string {
  if (input.destination === "cowork") {
    return "Cowork";
  }
  return input.selectedRepository?.name ?? "Choose repository";
}

function runtimeDetail(input: {
  destination: HomeNextDestination;
  repoLaunchKind: HomeNextRepoLaunchKind;
  selectedBranchName: string | null;
}): string | null {
  if (input.destination === "cowork") {
    return null;
  }
  if (input.repoLaunchKind === "local") {
    return launchKindDetail(input.repoLaunchKind);
  }
  return input.selectedBranchName ?? "base branch";
}

function TargetSection({ label }: { label: string }) {
  return (
    <div className="px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground/60">
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
    return "Project: Cowork";
  }
  return input.selectedRepository
    ? `Project: ${input.selectedRepository.name} repository`
    : "Project: Choose repository";
}

function runtimeAriaLabel(input: {
  label: string;
  detail: string | null;
  selectedRepository: SettingsRepositoryEntry | null;
  destination: HomeNextDestination;
}): string {
  if (!input.selectedRepository || input.destination === "cowork") {
    return "Runtime: no repository selected";
  }
  return input.detail ? `Runtime: ${input.label}, ${input.detail}` : `Runtime: ${input.label}`;
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
  const canShowBranchChoices =
    isRepositoryTarget && (repoLaunchKind === "worktree" || repoLaunchKind === "cloud");
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
  const runtimeButtonDetail = runtimeDetail({
    destination,
    repoLaunchKind,
    selectedBranchName,
  });
  const runtimeButton = (
    <PillControlButton
      icon={launchKindIcon(repoLaunchKind)}
      label={destination === "cowork" ? "No repository" : runtimeLabel}
      detail={runtimeButtonDetail}
      disabled={!selectedRepository || destination === "cowork"}
      disclosure={!!selectedRepository && destination === "repository"}
      aria-label={runtimeAriaLabel({
        label: runtimeLabel,
        detail: runtimeButtonDetail,
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
              : <GitBranchIcon className="size-3.5" />}
            label={projectLabel({ destination, selectedRepository })}
            detail={destination === "repository" ? "repository" : null}
            disclosure
            aria-label={projectAriaLabel({ destination, selectedRepository })}
            className="max-w-[14rem]"
          />
        )}
        side="top"
        className="w-[23rem] rounded-xl border border-border bg-popover p-1 shadow-floating"
      >
        {(close) => (
          <PickerPopoverContent
            searchValue={projectSearchValue}
            searchPlaceholder="Search repositories"
            onSearchChange={setProjectSearchValue}
          >
            <TargetSection label="Start without a repository" />
            <PopoverMenuItem
              icon={<Sparkles className="size-3.5" />}
              label="Cowork"
              trailing={destination === "cowork" ? <Check className="size-3.5" /> : null}
              onClick={() => {
                onSelectCowork();
                clearSearch();
                close();
              }}
            >
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                Start a cowork thread
              </span>
            </PopoverMenuItem>

            <TargetSection label="Repository" />
            {filteredRepositories.map((repository) => {
              const isSelected =
                destination === "repository"
                && selectedRepository?.sourceRoot === repository.sourceRoot;
              return (
                <PopoverMenuItem
                  key={repository.sourceRoot}
                  icon={<GitBranchIcon className="size-3.5" />}
                  label={repository.name}
                  trailing={isSelected ? <Check className="size-3.5" /> : null}
                  onClick={() => {
                    onSelectRepository(repository.sourceRoot);
                    clearSearch();
                    close();
                  }}
                >
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {repository.sourceRoot}
                  </span>
                </PopoverMenuItem>
              );
            })}
            {filteredRepositories.length === 0 ? (
              <PickerEmptyRow label="No repositories found" />
            ) : null}

            <PopoverMenuItem
              icon={<Plus className="size-3.5" />}
              label="Add repository"
              onClick={() => {
                onAddRepository();
                clearSearch();
                close();
              }}
            />
          </PickerPopoverContent>
        )}
      </PopoverButton>

      {selectedRepository && destination === "repository" ? (
        <PopoverButton
          trigger={runtimeButton}
          side="top"
          className="w-[22rem] rounded-xl border border-border bg-popover p-1 shadow-floating"
        >
          {(close) => (
            <PickerPopoverContent
            >
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
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {targetRowSubtext({
                        repository: selectedRepository,
                        launchKind,
                        selectedBranchName,
                      })}
                    </span>
                  </PopoverMenuItem>
                );
              })}

              {canShowBranchChoices ? (
                <>
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
                </>
              ) : null}
            </PickerPopoverContent>
          )}
        </PopoverButton>
      ) : null}
      {!selectedRepository && destination === "repository" ? runtimeButton : null}
    </>
  );
}
