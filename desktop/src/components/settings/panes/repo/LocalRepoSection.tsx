import { useMemo } from "react";
import { useDetectRepoRootSetupQuery } from "@anyharness/sdk-react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import { SetupCommandEditor } from "@/components/workspace/repo-setup/SetupCommandEditor";
import { useRepositorySettings } from "@/hooks/settings/use-repository-settings";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

interface LocalRepoSectionProps {
  repository: SettingsRepositoryEntry;
}

export function LocalRepoSection({ repository }: LocalRepoSectionProps) {
  const {
    branches,
    explicitDefaultBranch,
    effectiveAutoDetectedBranch,
    setupDraft,
    setSetupDraft,
    setExplicitDefaultBranch,
  } = useRepositorySettings(repository);

  const { data: detectionResult, isLoading: isDetecting } = useDetectRepoRootSetupQuery({
    repoRootId: repository.repoRootId,
    enabled: true,
  });

  const effectiveBranchLabel = explicitDefaultBranch
    ?? effectiveAutoDetectedBranch
    ?? "No branches found";
  const branchButtonLabel = explicitDefaultBranch
    ? explicitDefaultBranch
    : effectiveAutoDetectedBranch
      ? `Auto-detect (${effectiveAutoDetectedBranch})`
      : "Auto-detect";

  const branchOptions = useMemo(() => [
    {
      id: "__auto__",
      label: "Auto-detect",
      detail: effectiveAutoDetectedBranch ? `Currently ${effectiveAutoDetectedBranch}` : "No branches found",
    },
    ...branches.map((branch) => ({
      id: branch.name,
      label: branch.name,
      detail: null,
    })),
  ], [branches, effectiveAutoDetectedBranch]);

  return (
    <SettingsCard>
      <div className="space-y-1.5 p-3">
        <p className="text-sm font-medium text-foreground">Local configuration</p>
        <p className="text-sm text-muted-foreground">
          Stored on this desktop and used when creating local worktrees for this repository.
        </p>
      </div>

      <SettingsCardRow
        label="Local default branch"
        description={`Base branch for new worktrees and pull requests. Effective branch: ${effectiveBranchLabel}`}
      >
        <SettingsMenu
          label={branchButtonLabel}
          className="w-56"
          menuClassName="w-64"
          groups={[{
            id: "branches",
            options: branchOptions.map((option) => ({
              id: option.id,
              label: option.label,
              detail: option.detail,
              selected: option.id === "__auto__"
                ? explicitDefaultBranch === null
                : explicitDefaultBranch === option.id,
              onSelect: () => setExplicitDefaultBranch(option.id === "__auto__" ? null : option.id),
            })),
          }]}
        />
      </SettingsCardRow>

      <SettingsCardRow
        label="Local setup commands"
        description="Commands to run after creating a new worktree (one per line)"
      >
        <div className="w-[24rem] max-w-full">
          <SetupCommandEditor
            hints={detectionResult?.hints ?? []}
            currentScript={setupDraft}
            onChange={setSetupDraft}
            isLoading={isDetecting}
          />
          <p className="mt-2 text-sm text-muted-foreground/80">
            Runs inside the new worktree. Available vars include{" "}
            <code>PROLIFERATE_WORKTREE_DIR</code>, <code>PROLIFERATE_REPO_DIR</code>,{" "}
            <code>PROLIFERATE_BRANCH</code>, and <code>PROLIFERATE_BASE_REF</code>.
          </p>
        </div>
      </SettingsCardRow>
    </SettingsCard>
  );
}
