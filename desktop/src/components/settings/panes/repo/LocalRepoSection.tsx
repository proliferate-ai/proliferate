import { useMemo } from "react";
import type { SetupHint } from "@anyharness/sdk";
import { useDetectRepoRootSetupQuery } from "@anyharness/sdk-react";
import {
  EnvironmentAdvancedDisclosure,
  EnvironmentField,
  EnvironmentSection,
} from "@/components/ui/EnvironmentLayout";
import { EnvironmentSearchSelect } from "@/components/ui/EnvironmentSearchSelect";
import { RunCommandHelp } from "@/components/settings/shared/RunCommandHelp";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Monitor } from "@/components/ui/icons";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";
import { useRepositorySettings } from "@/hooks/settings/use-repository-settings";
import {
  isSetupHintEnabled,
  toggleSetupHint,
} from "@/lib/domain/settings/setup-hints";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

interface LocalRepoSectionProps {
  repository: SettingsRepositoryEntry;
}

function SetupHintRows({
  title,
  hints,
  currentScript,
  onChange,
}: {
  title: string;
  hints: SetupHint[];
  currentScript: string;
  onChange: (script: string) => void;
}) {
  if (hints.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-1">
        {hints.map((hint) => {
          const checked = isSetupHintEnabled(currentScript, hint.suggestedCommand);
          return (
            <Label
              key={hint.id}
              className="mb-0 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-foreground/5"
            >
              <Checkbox
                checked={checked}
                onChange={(event) => onChange(toggleSetupHint(
                  currentScript,
                  hint.suggestedCommand,
                  event.target.checked,
                ))}
                className="size-3.5 shrink-0 accent-foreground"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {hint.suggestedCommand}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {hint.detectedFile}
              </span>
            </Label>
          );
        })}
      </div>
    </div>
  );
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
  const buildToolHints = detectionResult?.hints.filter((hint) => hint.category === "build_tool") ?? [];
  const secretSyncHints = detectionResult?.hints.filter((hint) => hint.category === "secret_sync") ?? [];
  const hasHints = buildToolHints.length > 0 || secretSyncHints.length > 0;

  return (
    <EnvironmentSection
      title="Local environment"
      description="Stored on this desktop and used when creating local worktrees for this repo."
      icon={Monitor}
      action={(
        <>
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
        </>
      )}
    >
      <EnvironmentField
        label="Default branch"
        description={`Base branch for new worktrees and pull requests. Effective branch: ${effectiveBranchLabel}`}
      >
        <EnvironmentSearchSelect
          label={branchButtonLabel}
          searchPlaceholder="Search branches"
          emptyLabel="No branches found"
          className="w-64"
          menuClassName="w-80"
          options={branchOptions.map((option) => ({
            id: option.id,
            label: option.label,
            detail: option.detail,
            selected: option.id === "__auto__"
              ? explicitDefaultBranch === null
              : explicitDefaultBranch === option.id,
            onSelect: () => setExplicitDefaultBranch(option.id === "__auto__" ? null : option.id),
          }))}
        />
      </EnvironmentField>

      <EnvironmentField
        label="Local action command"
        description="Command launched by the workspace header Run button for this environment"
      >
        <div className="space-y-2">
          <Input
            value={runCommandDraft}
            onChange={(event) => setRunCommandDraft(event.target.value)}
            placeholder="make dev PROFILE=my-profile"
            className="h-8 max-w-xl px-2.5 py-1.5 font-mono text-sm leading-[var(--readable-code-line-height)]"
          />
          <RunCommandHelp scope="selected workspace" className="text-sm text-muted-foreground/80" />
        </div>
      </EnvironmentField>

      <EnvironmentField
        label="Setup script"
        description="Commands to run after creating a new worktree (one per line)"
      >
        <div className="space-y-2">
          <Textarea
            variant="code"
            rows={6}
            value={setupDraft}
            onChange={(event) => setSetupDraft(event.target.value)}
            placeholder={"pnpm install\npnpm prisma generate"}
            className="min-h-36 px-2.5 py-2 text-sm"
          />
          <p className="text-sm text-muted-foreground/80">
            Runs inside the new worktree. Available vars include{" "}
            <code>PROLIFERATE_WORKTREE_DIR</code>, <code>PROLIFERATE_REPO_DIR</code>,{" "}
            <code>PROLIFERATE_BRANCH</code>, and <code>PROLIFERATE_BASE_REF</code>.
          </p>
        </div>
      </EnvironmentField>

      <EnvironmentAdvancedDisclosure
        title="Advanced"
        description="Detected setup commands and ignored-file sync helpers."
      >
        {isDetecting ? (
          <div className="flex animate-pulse flex-col gap-2">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-4 w-56 rounded bg-muted" />
          </div>
        ) : hasHints ? (
          <div className="space-y-4">
            <SetupHintRows
              title="Detected"
              hints={buildToolHints}
              currentScript={setupDraft}
              onChange={setSetupDraft}
            />
            <SetupHintRows
              title="Sync ignored files"
              hints={secretSyncHints}
              currentScript={setupDraft}
              onChange={setSetupDraft}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No setup suggestions were detected for this environment.
          </p>
        )}
      </EnvironmentAdvancedDisclosure>
    </EnvironmentSection>
  );
}
