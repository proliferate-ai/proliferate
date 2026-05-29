import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentAuthMutations } from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Badge } from "@/components/ui/Badge";
import { CloudIcon } from "@/components/ui/icons";
import {
  EnvironmentField,
  EnvironmentSection,
} from "@/components/ui/EnvironmentLayout";
import { RepoEnvVarsCard } from "@/components/cloud/repo-settings/RepoEnvVarsCard";
import { RepoRunCommandCard } from "@/components/cloud/repo-settings/RepoRunCommandCard";
import { RepoSharedEnvFilesCard } from "@/components/cloud/repo-settings/RepoSharedEnvFilesCard";
import { RepoSetupScriptCard } from "@/components/cloud/repo-settings/RepoSetupScriptCard";
import { AdminOnlyPlaceholder } from "@/components/settings/shared/AdminOnlyPlaceholder";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import type { SettingsSection } from "@/config/settings";
import { useOrganizationCloudRepoConfig } from "@/hooks/access/cloud/use-cloud-repo-config";
import { useOrganizationCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useSaveOrganizationCloudRepoConfig } from "@/hooks/access/cloud/use-save-organization-cloud-repo-config";
import { useCloudRepoConfigDraft } from "@/hooks/cloud/ui/use-cloud-repo-config-draft";
import type { CloudRepoConfigSummary } from "@/lib/domain/cloud/repo-configs";
import {
  cloudRepositoryKey,
  isCloudRepository,
  type CloudSettingsRepositoryEntry,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { SharedSandboxOverview } from "@/components/settings/panes/shared-sandbox/SharedSandboxOverview";
import { buildSettingsHref, type SettingsFocus } from "@/lib/domain/settings/navigation";

interface SharedEnvironmentsPaneProps {
  isAdmin: boolean;
  isCheckingAdmin: boolean;
  role: string | null;
  activeOrganizationId: string | null;
  repositories: SettingsRepositoryEntry[];
  focus?: SettingsFocus;
  onOpenSettingsSection: (section: SettingsSection) => void;
}

interface SharedEnvironmentEntry {
  key: string;
  gitOwner: string;
  gitRepoName: string;
  label: string;
  description: string;
  configured: boolean;
  configuredAt: string | null;
  localRepository: CloudSettingsRepositoryEntry | null;
}

export function SharedEnvironmentsPane({
  isAdmin,
  isCheckingAdmin,
  role,
  activeOrganizationId,
  repositories,
  focus,
  onOpenSettingsSection,
}: SharedEnvironmentsPaneProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const organizationConfigs = useOrganizationCloudRepoConfigs(
    activeOrganizationId,
    isAdmin && activeOrganizationId !== null,
  );
  const entries = useMemo(
    () => buildSharedEnvironmentEntries(
      repositories,
      organizationConfigs.data?.configs ?? [],
    ),
    [organizationConfigs.data?.configs, repositories],
  );
  const focusedKey = focus?.cloudRepoOwner && focus.cloudRepoName
    ? cloudRepositoryKey(focus.cloudRepoOwner, focus.cloudRepoName)
    : null;
  useEffect(() => {
    if (!focusedKey || selectedKey === focusedKey) {
      return;
    }
    if (entries.some((entry) => entry.key === focusedKey)) {
      setSelectedKey(focusedKey);
    }
  }, [entries, focusedKey, selectedKey]);
  const selectedEntry = entries.find((entry) => entry.key === selectedKey) ?? null;

  if (isCheckingAdmin) {
    return (
      <SharedEnvironmentsShell>
        <SettingsCard>
          <div className="p-3 text-sm text-muted-foreground">Checking admin access...</div>
        </SettingsCard>
      </SharedEnvironmentsShell>
    );
  }

  if (!isAdmin) {
    return (
      <SharedEnvironmentsShell>
        <AdminOnlyPlaceholder
          role={role}
          onOpenOrganization={() => onOpenSettingsSection("organization")}
        />
      </SharedEnvironmentsShell>
    );
  }

  if (activeOrganizationId === null) {
    return (
      <SharedEnvironmentsShell>
        <SettingsCard>
          <SettingsCardRow
            label="Select an organization"
            description="Shared Sandbox is configured per organization."
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenSettingsSection("organization")}
            >
              Open
            </Button>
          </SettingsCardRow>
        </SettingsCard>
      </SharedEnvironmentsShell>
    );
  }

  if (selectedEntry) {
    return (
      <SharedEnvironmentDetail
        organizationId={activeOrganizationId}
        entry={selectedEntry}
        onBack={() => {
          setSelectedKey(null);
          navigate(buildSettingsHref({ section: "shared-environments" }));
        }}
      />
    );
  }

  return (
    <SharedEnvironmentsShell>
      <SharedSandboxOverview
        organizationId={activeOrganizationId}
      />
    </SharedEnvironmentsShell>
  );
}

function SharedEnvironmentDetail({
  organizationId,
  entry,
  onBack,
}: {
  organizationId: string;
  entry: SharedEnvironmentEntry;
  onBack: () => void;
}) {
  const {
    data: savedConfig,
    isLoading,
  } = useOrganizationCloudRepoConfig(
    organizationId,
    entry.gitOwner,
    entry.gitRepoName,
    true,
  );
  const draft = useCloudRepoConfigDraft({
    savedConfig,
    localSetupScript: "",
    localRunCommand: "",
    sourceKey: `shared:${organizationId}:${entry.key}`,
  });
  const saveMutation = useSaveOrganizationCloudRepoConfig();
  const authMutations = useAgentAuthMutations();
  const errorMessage = saveMutation.error?.message ?? null;
  const configured = savedConfig?.configured ?? false;
  const statusLabel = !draft.configured && configured
    ? "Will disable"
    : configured
      ? draft.dirty
        ? "Unsaved changes"
        : "Saved"
      : draft.configured
        ? "Not saved yet"
        : "Disabled";
  const isSaving = saveMutation.isPending
    || authMutations.isEnsuringProfile
    || authMutations.isEnablingProfileCloud;
  const saveDisabled = isLoading || isSaving || !draft.canSave;
  const revertDisabled = isSaving || !draft.dirty;

  async function handleSave() {
    const response = await saveMutation.mutateAsync({
      organizationId,
      gitOwner: entry.gitOwner,
      gitRepoName: entry.gitRepoName,
      configured: draft.savePayload.configured,
      defaultBranch: draft.savePayload.defaultBranch,
      envVars: draft.savePayload.envVars,
      setupScript: draft.savePayload.setupScript,
      runCommand: draft.savePayload.runCommand,
      files: draft.sharedEnvFilesDirty ? draft.sharedEnvFilePayloads : undefined,
    });
    const profile = await authMutations.ensureOrganizationProfile({ organizationId });
    await authMutations.enableProfileCloud({ sandboxProfileId: profile.id });
    draft.resetFromSavedConfig(response);
  }

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          Shared Sandbox
        </Button>
        <SettingsPageHeader
          title={entry.label}
          description="Configure the commands and environment values used when this repo runs in the shared cloud sandbox."
          action={<Badge>Admin</Badge>}
        />
      </div>

      <EnvironmentSection
        title="Shared cloud environment"
        icon={CloudIcon}
        description={`Saved to the organization sandbox for ${entry.label}.`}
        action={(
          <>
            <Badge tone={statusLabel === "Saved" ? "success" : "neutral"}>{statusLabel}</Badge>
            {configured && (
              <Button
                type="button"
                variant="outline"
                disabled={!draft.configured || isSaving}
                onClick={draft.disable}
              >
                {draft.configured ? "Disable shared cloud" : "Disable pending"}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={revertDisabled}
              onClick={draft.revert}
            >
              Revert
            </Button>
            <Button
              type="button"
              loading={isSaving}
              disabled={saveDisabled}
              onClick={() => { void handleSave(); }}
            >
              {configured ? "Save" : "Enable shared cloud"}
            </Button>
          </>
        )}
      >
        {errorMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : null}

        <EnvironmentField
          label="Default branch"
          description="Branch used when shared automations or Slack sessions create new worktrees for this repo."
        >
          <Input
            value={draft.defaultBranch ?? ""}
            onChange={(event) => draft.setDefaultBranch(event.target.value)}
            placeholder="main"
            className="h-8 max-w-xl px-2.5 py-1.5 font-mono text-sm leading-[var(--readable-code-line-height)]"
          />
        </EnvironmentField>

        <RepoRunCommandCard
          runCommand={draft.runCommand}
          onChange={draft.setRunCommand}
        />

        <RepoSetupScriptCard
          setupScript={draft.setupScript}
          onChange={draft.setSetupScript}
        />

        <RepoEnvVarsCard
          rows={draft.envVarRows}
          onAddRow={draft.addEnvVarRow}
          onUpdateRow={draft.updateEnvVarRow}
          onRemoveRow={draft.removeEnvVarRow}
        />

        <RepoSharedEnvFilesCard
          files={draft.sharedEnvFiles}
          onAddFile={draft.addSharedEnvFile}
          onUpdateFilePath={draft.updateSharedEnvFilePath}
          onAddRow={draft.addSharedEnvFileRow}
          onUpdateRow={draft.updateSharedEnvFileRow}
          onRemoveRow={draft.removeSharedEnvFileRow}
          onRemoveFile={draft.removeSharedEnvFile}
        />
      </EnvironmentSection>
    </section>
  );
}

function SharedEnvironmentsShell({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Shared Sandbox"
        description="The runtime your team's shared work uses. The only page where this is configured."
        action={<Badge>Admin</Badge>}
      />
      {children}
    </section>
  );
}

function buildSharedEnvironmentEntries(
  repositories: SettingsRepositoryEntry[],
  configs: CloudRepoConfigSummary[],
): SharedEnvironmentEntry[] {
  const byKey = new Map<string, SharedEnvironmentEntry>();

  for (const repository of repositories) {
    if (!isCloudRepository(repository)) {
      continue;
    }
    const key = cloudRepositoryKey(repository.gitOwner, repository.gitRepoName);
    byKey.set(key, {
      key,
      gitOwner: repository.gitOwner,
      gitRepoName: repository.gitRepoName,
      label: `${repository.gitOwner}/${repository.gitRepoName}`,
      description: repository.secondaryLabel ?? repository.sourceRoot,
      configured: false,
      configuredAt: null,
      localRepository: repository,
    });
  }

  for (const config of configs) {
    const key = cloudRepositoryKey(config.gitOwner, config.gitRepoName);
    const existing = byKey.get(key);
    byKey.set(key, {
      key,
      gitOwner: config.gitOwner,
      gitRepoName: config.gitRepoName,
      label: `${config.gitOwner}/${config.gitRepoName}`,
      description: existing?.description ?? "Organization cloud repo",
      configured: config.configured,
      configuredAt: config.configuredAt,
      localRepository: existing?.localRepository ?? null,
    });
  }

  return [...byKey.values()].sort((left, right) =>
    left.label.localeCompare(right.label));
}
