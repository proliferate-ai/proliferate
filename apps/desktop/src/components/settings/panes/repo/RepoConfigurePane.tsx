import { useMemo } from "react";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSaveFooter } from "@proliferate/product-ui/settings/SettingsSaveFooter";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import {
  EnvironmentSearchSelect,
  type EnvironmentSearchSelectOption,
} from "@proliferate/ui/primitives/EnvironmentSearchSelect";
import { useCloudRepoEnvironmentEditor } from "@/hooks/settings/workflows/use-cloud-repo-environment-editor";
import { useRepositorySettings } from "@/hooks/settings/workflows/use-repository-settings";
import { type SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { RepoCloudGate } from "./RepoCloudGate";
import {
  LocalNoCheckoutState,
  RepoScopeEmptyState,
  type RepoScopePaneProps,
  type RepoScopeSelectionCallbacks,
} from "./RepoScopeStates";

/**
 * Repo → Configure: defaults applied when agents create workspaces for this
 * repo, per the picked Cloud|Local context.
 *
 * HONEST OMISSIONS vs the design-system bench (no backing API anywhere):
 * "Base for new branches" (the API has one `defaultBranch` field, no second
 * base-branch field), the WORKSPACES section (base workspace type, clone
 * depth), and the PREFERENCES switches (auto-create worktree, fetch before
 * new workspace, run-setup-on-create). They render nothing here rather than
 * fake controls.
 */
export function RepoConfigurePane({
  repository,
  context,
  cloudEnabled,
  cloudActive,
  cloudSignInChecking,
  cloudSignInAvailable,
  onSelectRepo,
  onSelectCloudEnvironment,
}: RepoScopePaneProps) {
  if (!repository) {
    return (
      <RepoScopeEmptyState
        onSelectRepo={onSelectRepo}
        onSelectCloudEnvironment={onSelectCloudEnvironment}
      />
    );
  }
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Configure"
        description="Defaults applied when agents create workspaces for this repo."
      />
      {context === "cloud" ? (
        <ConfigureCloud
          repository={repository}
          cloudEnabled={cloudEnabled}
          cloudActive={cloudActive}
          cloudSignInChecking={cloudSignInChecking}
          cloudSignInAvailable={cloudSignInAvailable}
        />
      ) : (
        <ConfigureLocal
          repository={repository}
          onSelectRepo={onSelectRepo}
          onSelectCloudEnvironment={onSelectCloudEnvironment}
        />
      )}
    </section>
  );
}

function ConfigureCloud({
  repository,
  cloudEnabled,
  cloudActive,
  cloudSignInChecking,
  cloudSignInAvailable,
}: {
  repository: SettingsRepositoryEntry;
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
}) {
  const editor = useCloudRepoEnvironmentEditor({ repository, cloudActive });
  const { draft, branches } = editor;
  const branchesLoading = branches.loading || editor.repoConfigsLoading;
  const savedBranch = draft.defaultBranch;
  const hasStaleSavedBranch = Boolean(savedBranch && !branches.names.includes(savedBranch));
  const branchOptions: EnvironmentSearchSelectOption[] = [
    {
      id: "__github__",
      label: "GitHub default",
      detail: branches.defaultBranch ? `Currently ${branches.defaultBranch}` : null,
      selected: savedBranch === null,
      onSelect: () => draft.setDefaultBranch(null),
    },
    ...(hasStaleSavedBranch && savedBranch ? [{
      id: savedBranch,
      label: `${savedBranch} (saved, missing on GitHub)`,
      selected: true,
      onSelect: () => draft.setDefaultBranch(savedBranch),
    }] : []),
    ...branches.names.map((branch) => ({
      id: branch,
      label: branch,
      selected: savedBranch === branch,
      onSelect: () => draft.setDefaultBranch(branch),
    })),
  ];

  return (
    <RepoCloudGate
      editor={editor}
      cloudEnabled={cloudEnabled}
      cloudActive={cloudActive}
      cloudSignInChecking={cloudSignInChecking}
      cloudSignInAvailable={cloudSignInAvailable}
    >
      <SettingsSection title="Branch">
        <SettingsRow
          label="Default branch"
          description={cloudBranchHelperText({
            branchesLoading,
            branchError: branches.error,
            githubDefaultBranch: branches.defaultBranch,
          })}
        >
          <EnvironmentSearchSelect
            label={savedBranch
              ?? (branches.defaultBranch ? `GitHub default (${branches.defaultBranch})` : "GitHub default")}
            options={branchOptions}
            searchPlaceholder="Search branches"
            emptyLabel="No branches found"
            className="w-64"
            menuClassName="w-80"
            disabled={branchesLoading}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSaveFooter
        statusLabel={editor.status.label}
        statusTone={editor.status.tone}
        error={editor.saveError}
        saving={editor.saving}
        saveDisabled={!cloudActive || editor.repoConfigsLoading || editor.saving || !draft.canSave}
        revertDisabled={editor.saving || !draft.dirty}
        onSave={() => {
          void editor.save();
        }}
        onRevert={draft.revert}
      />
    </RepoCloudGate>
  );
}

function cloudBranchHelperText({
  branchesLoading,
  branchError,
  githubDefaultBranch,
}: {
  branchesLoading: boolean;
  branchError: string | null;
  githubDefaultBranch: string | null;
}): string {
  if (branchError) {
    return branchError;
  }
  if (branchesLoading) {
    return "Loading GitHub branches...";
  }
  if (githubDefaultBranch) {
    return `Leaving this on GitHub default follows ${githubDefaultBranch}.`;
  }
  return "Leaving this on GitHub default follows the repo's current default branch.";
}

function ConfigureLocal({
  repository,
  ...callbacks
}: RepoScopeSelectionCallbacks & {
  repository: SettingsRepositoryEntry;
}) {
  if (repository.availability === "cloud") {
    return <LocalNoCheckoutState repository={repository} {...callbacks} />;
  }
  return <ConfigureLocalEditor repository={repository} />;
}

function ConfigureLocalEditor({ repository }: { repository: SettingsRepositoryEntry }) {
  const {
    branches,
    explicitDefaultBranch,
    effectiveAutoDetectedBranch,
    setExplicitDefaultBranch,
    canSave,
    canRevert,
    save,
    revert,
  } = useRepositorySettings(repository);

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
    <>
      <SettingsSection title="Branch">
        <SettingsRow
          label="Default branch"
          description={`Base branch for new worktrees and pull requests · Effective: ${effectiveBranchLabel}`}
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
        </SettingsRow>
      </SettingsSection>
      <SettingsSaveFooter
        saveDisabled={!canSave}
        revertDisabled={!canRevert}
        onSave={save}
        onRevert={revert}
      />
    </>
  );
}
