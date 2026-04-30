import { useMemo } from "react";
import { useDetectRepoRootSetupQuery } from "@anyharness/sdk-react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsEditorRow } from "@/components/settings/SettingsEditorRow";
import { RunCommandHelp } from "@/components/settings/RunCommandHelp";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
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
    runCommandDraft,
    setSetupDraft,
    setRunCommandDraft,
    setExplicitDefaultBranch,
    canSave,
    canRevert,
    save,
    revert,
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
      <div className="flex flex-wrap items-start justify-between gap-3 p-3">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Local environment</p>
          <p className="text-sm text-muted-foreground">
            Stored on this desktop and used when creating local worktrees for this repo.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!canRevert}
            onClick={revert}
          >
            Revert
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canSave}
            onClick={save}
          >
            Save
          </Button>
        </div>
      </div>

      <SettingsEditorRow
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
      </SettingsEditorRow>

      <SettingsEditorRow
        label="Local run command"
        description="Command launched by the workspace header Run button for this environment"
      >
        <div className="space-y-2">
          <Input
            value={runCommandDraft}
            onChange={(event) => setRunCommandDraft(event.target.value)}
            placeholder="make dev PROFILE=my-profile"
            className="font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)]"
          />
          <RunCommandHelp scope="selected workspace" className="text-sm text-muted-foreground/80" />
        </div>
      </SettingsEditorRow>

      <SettingsEditorRow
        label="Local setup commands"
        description="Commands to run after creating a new worktree (one per line)"
      >
        <div>
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
      </SettingsEditorRow>
    </SettingsCard>
  );
}
