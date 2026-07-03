import { type ChangeEvent } from "react";
import type { SetupHint } from "@anyharness/sdk";
import { useDetectRepoRootSetupQuery } from "@anyharness/sdk-react";
import { ScriptBlock } from "@proliferate/product-ui/environments/ScriptBlock";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSaveFooter } from "@proliferate/product-ui/settings/SettingsSaveFooter";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { SkeletonBlock, shimmerDelay } from "@/components/feedback/Skeleton";
import { RunCommandHelp } from "@/components/settings/shared/RunCommandHelp";
import { useCloudRepoEnvironmentEditor } from "@/hooks/settings/workflows/use-cloud-repo-environment-editor";
import { useRepositorySettings } from "@/hooks/settings/workflows/use-repository-settings";
import {
  isSetupHintEnabled,
  toggleSetupHint,
} from "@/lib/domain/settings/setup-hints";
import { type SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { RepoCloudGate } from "./RepoCloudGate";
import {
  LocalNoCheckoutState,
  RepoScopeEmptyState,
  type RepoScopePaneProps,
  type RepoScopeSelectionCallbacks,
} from "./RepoScopeStates";

const SCRIPT_PLACEHOLDER = "pnpm install\npnpm prisma generate";
const RUN_COMMAND_INPUT_CLASS = "h-8 w-72 px-2.5 font-mono text-ui-sm";

/**
 * Repo → Actions: scripts that run around agent workspaces for this repo, per
 * the picked Cloud|Local context.
 *
 * HONEST OMISSIONS vs the design-system bench (no backing API anywhere):
 * the ARCHIVE SCRIPT section (no such field exists on any endpoint) and the
 * setup-script attached-file chips (there is no attach-files-to-script API —
 * cloud secret files belong to the Environment page). The bench's RUN SCRIPT
 * renders as "Run command" because the API field is a single-line command.
 */
export function RepoActionsPane({
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
        title="Actions"
        description="Scripts that run around agent workspaces for this repo."
      />
      {context === "cloud" ? (
        <ActionsCloud
          repository={repository}
          cloudEnabled={cloudEnabled}
          cloudActive={cloudActive}
          cloudSignInChecking={cloudSignInChecking}
          cloudSignInAvailable={cloudSignInAvailable}
        />
      ) : (
        <ActionsLocal
          repository={repository}
          onSelectRepo={onSelectRepo}
          onSelectCloudEnvironment={onSelectCloudEnvironment}
        />
      )}
    </section>
  );
}

function ActionsCloud({
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
  const { draft } = editor;

  return (
    <RepoCloudGate
      editor={editor}
      cloudEnabled={cloudEnabled}
      cloudActive={cloudActive}
      cloudSignInChecking={cloudSignInChecking}
      cloudSignInAvailable={cloudSignInAvailable}
    >
      <SettingsSection title="Setup script">
        <div className="space-y-2 pt-2">
          <ScriptBlock
            ariaLabel="Cloud setup script"
            fileLabel="setup.sh"
            value={draft.setupScript}
            placeholder={SCRIPT_PLACEHOLDER}
            onChange={draft.setSetupScript}
            className="w-full"
          />
          <p className="text-ui-sm text-muted-foreground/80">
            Runs once when a cloud workspace is created.
          </p>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Run command"
        description="Launched by the workspace Run action in cloud workspaces."
      >
        <div className="pt-2">
          <Input
            aria-label="Cloud run command"
            value={draft.runCommand}
            placeholder="make dev"
            className={RUN_COMMAND_INPUT_CLASS}
            onChange={(event: ChangeEvent<HTMLInputElement>) => draft.setRunCommand(event.currentTarget.value)}
          />
        </div>
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

function ActionsLocal({
  repository,
  ...callbacks
}: RepoScopeSelectionCallbacks & {
  repository: SettingsRepositoryEntry;
}) {
  if (repository.availability === "cloud") {
    return <LocalNoCheckoutState repository={repository} {...callbacks} />;
  }
  return <ActionsLocalEditor repository={repository} />;
}

function ActionsLocalEditor({ repository }: { repository: SettingsRepositoryEntry }) {
  const {
    setupDraft,
    setSetupDraft,
    runCommandDraft,
    setRunCommandDraft,
    canSave,
    canRevert,
    save,
    revert,
  } = useRepositorySettings(repository);
  const { data: detectionResult, isLoading: isDetecting } = useDetectRepoRootSetupQuery({
    repoRootId: repository.repoRootId,
    enabled: true,
  });
  const buildToolHints = detectionResult?.hints.filter((hint) => hint.category === "build_tool") ?? [];
  const secretSyncHints = detectionResult?.hints.filter((hint) => hint.category === "secret_sync") ?? [];
  const hasHints = buildToolHints.length > 0 || secretSyncHints.length > 0;

  return (
    <>
      <SettingsSection title="Setup script">
        <div className="space-y-2 pt-2">
          <ScriptBlock
            ariaLabel="Local setup script"
            fileLabel="setup.sh"
            value={setupDraft}
            placeholder={SCRIPT_PLACEHOLDER}
            onChange={setSetupDraft}
            className="w-full"
          />
          <p className="text-ui-sm text-muted-foreground/80">
            Runs inside the new worktree. Available vars include{" "}
            <code>PROLIFERATE_WORKTREE_DIR</code>, <code>PROLIFERATE_REPO_DIR</code>,{" "}
            <code>PROLIFERATE_BRANCH</code>, and <code>PROLIFERATE_BASE_REF</code>.
          </p>
        </div>
        {isDetecting || hasHints ? (
          <SettingsRow
            label="Suggestions"
            description="Detected setup commands and ignored-file sync helpers."
            className="sm:flex-col sm:items-stretch"
          >
            {isDetecting ? (
              <div className="flex flex-col gap-2" role="status" aria-label="Detecting setup commands">
                <SkeletonBlock className="h-4 w-32" style={shimmerDelay(0)} />
                <SkeletonBlock className="h-4 w-56" style={shimmerDelay(1)} />
              </div>
            ) : (
              <div className="w-full space-y-4">
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
            )}
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Run command">
        <div className="w-72 space-y-2 pt-2">
          <Input
            aria-label="Local run command"
            value={runCommandDraft}
            placeholder="make dev PROFILE=my-profile"
            className={RUN_COMMAND_INPUT_CLASS}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setRunCommandDraft(event.currentTarget.value)}
          />
          <RunCommandHelp scope="selected workspace" className="text-ui-sm text-muted-foreground/80" />
        </div>
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
      <p className="text-ui-sm font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-0.5">
        {hints.map((hint) => {
          const checked = isSetupHintEnabled(currentScript, hint.suggestedCommand);
          return (
            <Label
              key={hint.id}
              className="mb-0 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-foreground/5"
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
              <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-foreground">
                {hint.suggestedCommand}
              </span>
              <span className="shrink-0 text-base text-muted-foreground">
                {hint.detectedFile}
              </span>
            </Label>
          );
        })}
      </div>
    </div>
  );
}
