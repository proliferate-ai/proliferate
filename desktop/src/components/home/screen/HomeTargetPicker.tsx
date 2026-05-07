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
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSelectCowork: () => void;
  onSelectRepositoryTarget: (
    sourceRoot: string,
    launchKind: HomeNextRepoLaunchKind,
  ) => void;
  onSelectBranch: (branchName: string) => void;
  onAddRepository: () => void;
  onConfigureCloud: (repository: SettingsRepositoryEntry) => void;
}

function launchKindLabel(kind: HomeNextRepoLaunchKind): string {
  switch (kind) {
    case "worktree":
      return "new worktree";
    case "local":
      return "local checkout";
    case "cloud":
      return "cloud workspace";
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

function targetLabel(input: {
  destination: HomeNextDestination;
  selectedRepository: SettingsRepositoryEntry | null;
  repoLaunchKind: HomeNextRepoLaunchKind;
  selectedBranchName: string | null;
}): string {
  if (input.destination === "cowork") {
    return "Cowork";
  }
  if (!input.selectedRepository) {
    return "Choose target";
  }

  const kind = launchKindLabel(input.repoLaunchKind);
  if (input.repoLaunchKind === "local") {
    return `${input.selectedRepository.name} · ${kind}`;
  }
  return `${input.selectedRepository.name} · ${input.selectedBranchName ?? "base branch"} · ${kind}`;
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
  isSelectedRepository: boolean;
}): string {
  if (input.launchKind === "local") {
    return `${input.repository.name} · existing checkout`;
  }

  const branch = input.isSelectedRepository
    ? input.selectedBranchName ?? "default branch"
    : "default branch";
  return `${input.repository.name} · ${branch}`;
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
  searchValue,
  onSearchChange,
  onSelectCowork,
  onSelectRepositoryTarget,
  onSelectBranch,
  onAddRepository,
  onConfigureCloud,
}: HomeTargetPickerProps) {
  const filteredRepositories = repositories.filter((repository) =>
    matchesPickerSearch([repository.name, repository.sourceRoot], searchValue)
  );
  const filteredBranches = branchOptions.filter((branch) =>
    matchesPickerSearch([branch], searchValue)
  );
  const isRepositoryTarget = destination === "repository" && !!selectedRepository;
  const canShowBranchChoices =
    isRepositoryTarget && (repoLaunchKind === "worktree" || repoLaunchKind === "cloud");

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          icon={destination === "cowork"
            ? <Sparkles className="size-3.5" />
            : <GitBranchIcon className="size-3.5" />}
          label={targetLabel({
            destination,
            selectedRepository,
            repoLaunchKind,
            selectedBranchName,
          })}
          disclosure
          className="max-w-[18rem]"
        />
      )}
      side="top"
      className="w-[26rem] rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <PickerPopoverContent
          searchValue={searchValue}
          searchPlaceholder="Search targets"
          onSearchChange={onSearchChange}
        >
          <TargetSection label="Destination" />
          <PopoverMenuItem
            icon={<Sparkles className="size-3.5" />}
            label="Cowork"
            trailing={destination === "cowork" ? <Check className="size-3.5" /> : null}
            onClick={() => {
              onSelectCowork();
              onSearchChange("");
              close();
            }}
          >
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              Start a cowork thread without a repository
            </span>
          </PopoverMenuItem>

          <TargetSection label="Create in repository" />
          {filteredRepositories.map((repository) => {
            const isSelectedRepository =
              destination === "repository"
              && selectedRepository?.sourceRoot === repository.sourceRoot;
            return (
              <div key={repository.sourceRoot}>
                {(["worktree", "local", "cloud"] as const).map((launchKind) => {
                  const repositoryCloudAction =
                    cloudActionBySourceRoot[repository.sourceRoot]
                    ?? { kind: "hidden", label: null };
                  const isSelected = isSelectedRepository && repoLaunchKind === launchKind;
                  const cloudConfigure = launchKind === "cloud"
                    && repositoryCloudAction.kind === "configure";
                  const cloudLoading = launchKind === "cloud"
                    && repositoryCloudAction.kind === "loading";
                  const cloudHidden = launchKind === "cloud"
                    && repositoryCloudAction.kind === "hidden";
                  const label = cloudConfigure
                    ? "Configure cloud workspace"
                    : cloudHidden
                      ? "Cloud unavailable"
                    : launchKind === "worktree"
                      ? "New worktree"
                      : launchKind === "local"
                        ? "Local checkout"
                        : "Cloud workspace";

                  return (
                    <PopoverMenuItem
                      key={`${repository.sourceRoot}:${launchKind}`}
                      icon={launchKindIcon(launchKind)}
                      label={label}
                      disabled={cloudLoading || cloudHidden}
                      trailing={isSelected ? <Check className="size-3.5" /> : null}
                      onClick={() => {
                        if (cloudConfigure) {
                          onConfigureCloud(repository);
                          onSearchChange("");
                          close();
                          return;
                        }
                        onSelectRepositoryTarget(repository.sourceRoot, launchKind);
                        onSearchChange("");
                        close();
                      }}
                    >
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {targetRowSubtext({
                          repository,
                          launchKind,
                          selectedBranchName,
                          isSelectedRepository,
                        })}
                      </span>
                    </PopoverMenuItem>
                  );
                })}
                <div className="my-1 h-px bg-border" />
              </div>
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
              onSearchChange("");
              close();
            }}
          />

          {canShowBranchChoices ? (
            <>
              <TargetSection label="Base branch" />
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
                      onSearchChange("");
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
  );
}
