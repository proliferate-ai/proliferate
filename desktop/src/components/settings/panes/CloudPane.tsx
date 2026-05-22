import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { ChevronRight } from "@/components/ui/icons";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { CloudAgentAuthLibrary } from "@/components/settings/panes/cloud/CloudAgentAuthLibrary";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import {
  cloudRepositoryKey,
  isCloudRepository,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useRuntimeInputSyncSummary } from "@/hooks/cloud/facade/use-runtime-input-sync-summary";

interface CloudPaneProps {
  repositories: SettingsRepositoryEntry[];
}

export function CloudPane({ repositories }: CloudPaneProps) {
  const navigate = useNavigate();
  const { data: repoConfigs } = useCloudRepoConfigs();
  const runtimeInputSync = useRuntimeInputSyncSummary(repositories);
  const cloudRepositories = repositories.filter(isCloudRepository);
  const repoConfigMap = useMemo(
    () => new Map(
      (repoConfigs?.configs ?? []).map((config) => [
        cloudRepositoryKey(config.gitOwner, config.gitRepoName),
        config,
      ]),
    ),
    [repoConfigs?.configs],
  );
  const agentCredentialDescription = runtimeInputSync.rows
    .find((row) => row.id === "credentials")
    ?.description ?? "Agent authentication sync is not configured.";
  const configuredEnvironmentCount = cloudRepositories.filter((repository) => {
    const repoKey = cloudRepositoryKey(repository.gitOwner, repository.gitRepoName);
    return repoConfigMap.get(repoKey)?.configured;
  }).length;
  const automaticSyncDescription = `${agentCredentialDescription} ${formatCount(
    configuredEnvironmentCount,
    "repo tracked-file set",
  )}`;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Cloud"
        description="Cloud syncing and environment configuration."
      />

      <CloudPaneSection title="Automatic syncing">
        <SettingsCard>
          <SettingsCardRow
            label="Automatically sync"
            description="Keep supported local inputs synced to cloud in the background."
          >
            <Switch
              checked={runtimeInputSync.enabled}
              onChange={runtimeInputSync.setEnabled}
              aria-label="Automatically sync cloud inputs"
            />
          </SettingsCardRow>
          <SettingsCardRow
            label="Defaults to sync"
            description={automaticSyncDescription}
          >
            <Badge className={runtimeInputSync.enabled ? "text-foreground" : ""}>
              {runtimeInputSync.enabled ? "Auto sync on" : "Auto sync off"}
            </Badge>
          </SettingsCardRow>
        </SettingsCard>
      </CloudPaneSection>

      <CloudAgentAuthLibrary />

      <CloudPaneSection
        title="Cloud environments"
        description="Open an environment to configure tracked files, env vars, and cloud setup."
      >
        <SettingsCard>
          {cloudRepositories.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">
              No GitHub-backed local repositories are available yet.
            </div>
          ) : (
            cloudRepositories.map((repository) => {
              const repoKey = cloudRepositoryKey(repository.gitOwner, repository.gitRepoName);
              const config = repoConfigMap.get(repoKey);

              return (
                <Button
                  key={repoKey}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-between rounded-none px-3 py-3 text-left whitespace-normal hover:bg-accent/50"
                  onClick={() => navigate(
                    buildSettingsHref({
                      section: "repo",
                      repo: repository.sourceRoot,
                    }),
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {repository.name}
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-normal text-muted-foreground">
                      {repository.secondaryLabel ?? `${repository.gitOwner}/${repository.gitRepoName}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <Badge>{config?.configured ? "Saved for cloud" : "Not saved yet"}</Badge>
                    <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
                      Open environment
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </span>
                </Button>
              );
            })
          )}
        </SettingsCard>
      </CloudPaneSection>
    </section>
  );
}

function CloudPaneSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function formatCount(count: number, singular: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : `${singular}s`}`;
}
