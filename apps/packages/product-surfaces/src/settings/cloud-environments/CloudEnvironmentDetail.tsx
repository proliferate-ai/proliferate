import { useMemo } from "react";
import {
  useCloudRepoBranches,
  useRepositories,
  useSaveRepoEnvironment,
} from "@proliferate/cloud-sdk-react";
import {
  buildCoreCloudEnvironmentSaveRequest,
  cloudEnvironmentStatusPresentation,
} from "@proliferate/product-domain/environments/cloud-environments";
import { formatGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import { CloudEnvironmentConfigSection } from "@proliferate/product-ui/environments/CloudEnvironmentConfigSection";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { ChevronRight } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { CloudSecretsSettingsSurface } from "../CloudSecretsSettingsSurface";
import { useCloudEnvironmentDraft } from "./use-cloud-environment-draft";

export function CloudEnvironmentDetail({
  gitOwner,
  gitRepoName,
  enabled,
  onBack,
  onSaved,
}: {
  gitOwner: string;
  gitRepoName: string;
  enabled: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
  const repoId = formatGitRepoId({ gitOwner, gitRepoName });
  const repoConfigs = useRepositories(enabled);
  const cloudEnvironment = useMemo(() => {
    const repo = repoConfigs.data?.repositories.find((candidate) =>
      candidate.gitProvider === "github"
      && candidate.gitOwner === gitOwner
      && candidate.gitRepoName === gitRepoName
    );
    return repo?.environments.find((environment) => environment.kind === "cloud") ?? null;
  }, [gitOwner, gitRepoName, repoConfigs.data?.repositories]);
  const branches = useCloudRepoBranches(gitOwner, gitRepoName, enabled);
  const saveEnvironment = useSaveRepoEnvironment();
  const draft = useCloudEnvironmentDraft({
    environment: cloudEnvironment,
    sourceKey: repoId,
  });
  const status = cloudEnvironmentStatusPresentation({
    configured: cloudEnvironment !== null,
    dirty: draft.dirty,
    materializationStatus: cloudEnvironment?.materialization?.status ?? null,
  });

  async function handleSave() {
    const response = await saveEnvironment.mutateAsync({
      gitOwner,
      gitRepoName,
      body: buildCoreCloudEnvironmentSaveRequest({
        defaultBranch: draft.defaultBranch,
        setupScript: draft.setupScript,
        runCommand: draft.runCommand,
      }),
    });
    draft.reset(response);
    onSaved();
  }

  return (
    <section className="space-y-6">
      <Button
        type="button"
        variant="ghost"
        className="h-auto px-0 py-0 text-sm hover:bg-transparent"
        onClick={onBack}
      >
        Environments
        <ChevronRight className="size-4" />
        <span className="text-foreground">{repoId}</span>
      </Button>

      <SettingsPageHeader
        title={repoId}
        description="Personal cloud environment — runs in Proliferate Cloud without a local checkout."
      />

      <CloudEnvironmentConfigSection
        statusLabel={status.label}
        statusTone={status.tone}
        defaultBranch={draft.defaultBranch}
        githubDefaultBranch={branches.data?.defaultBranch ?? null}
        branches={branches.data?.branches ?? []}
        branchesLoading={branches.isLoading || repoConfigs.isLoading}
        branchError={branches.error instanceof Error ? branches.error.message : null}
        setupScript={draft.setupScript}
        runCommand={draft.runCommand}
        saving={saveEnvironment.isPending}
        saveDisabled={!enabled || repoConfigs.isLoading || saveEnvironment.isPending || !draft.canSave}
        revertDisabled={saveEnvironment.isPending || !draft.dirty}
        error={saveEnvironment.error?.message ?? null}
        onDefaultBranchChange={draft.setDefaultBranch}
        onSetupScriptChange={draft.setSetupScript}
        onRunCommandChange={draft.setRunCommand}
        onSave={() => {
          void handleSave();
        }}
        onRevert={draft.revert}
      />

      {cloudEnvironment !== null ? (
        <CloudSecretsSettingsSurface
          scope={{ kind: "workspace", gitOwner, gitRepoName }}
          enabled={enabled}
        />
      ) : (
        <SettingsSection title="Cloud secrets">
          <SettingsRow
            label="Environment variables & files"
            description="Save the cloud environment first. Secrets sync to cloud sandboxes for this repository and never touch your local machine."
          />
        </SettingsSection>
      )}
    </section>
  );
}
