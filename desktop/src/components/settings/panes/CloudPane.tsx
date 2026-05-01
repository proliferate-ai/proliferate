import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { ChevronRight } from "@/components/ui/icons";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { CloudBillingSummary } from "@/components/settings/panes/CloudBillingSummary";
import { AUTH_ACCOUNT_LABELS } from "@/config/auth";
import { CLOUD_CREDENTIAL_PROVIDER_ORDER } from "@/config/cloud-providers";
import { getProviderDisplayName } from "@/config/providers";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import { describeCloudCredentialStatus } from "@/lib/domain/cloud/credentials";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import {
  cloudRepositoryKey,
  isCloudRepository,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { useGitHubSignIn } from "@/hooks/auth/use-github-sign-in";
import {
  useCloudBilling,
  useCloudBillingActions,
} from "@/hooks/cloud/use-cloud-billing";
import { useCloudCredentialActions } from "@/hooks/cloud/use-cloud-credential-actions";
import { useCloudCredentials } from "@/hooks/cloud/use-cloud-credentials";
import { useCloudRepoConfigs } from "@/hooks/cloud/use-cloud-repo-configs";
import { useRuntimeInputSyncSummary } from "@/hooks/cloud/use-runtime-input-sync-summary";
import type {
  CloudAgentKind,
  CloudCredentialStatus,
  CloudRepoConfigSummary,
} from "@/lib/integrations/cloud/client";
import { isCloudAgentKind } from "@/lib/integrations/cloud/client";
import { useAuthStore } from "@/stores/auth/auth-store";

const EMPTY_CLOUD_CREDENTIAL_STATUSES: CloudCredentialStatus[] = [];

interface CloudPaneProps {
  repositories: SettingsRepositoryEntry[];
}

export function CloudPane({ repositories }: CloudPaneProps) {
  const navigate = useNavigate();
  const { data: credentialStatuses = EMPTY_CLOUD_CREDENTIAL_STATUSES } = useCloudCredentials();
  const { data: billingPlan } = useCloudBilling();
  const billingActions = useCloudBillingActions();
  const { data: repoConfigs } = useCloudRepoConfigs();
  const runtimeInputSync = useRuntimeInputSyncSummary(repositories);
  const { syncCloudCredential, deleteCloudCredential } = useCloudCredentialActions();
  const {
    signIn: signInWithGitHub,
    submitting: signingIn,
    error: signInError,
  } = useGitHubSignIn();
  const authStatus = useAuthStore((state) => state.status);
  const [syncingProvider, setSyncingProvider] = useState<CloudAgentKind | null>(null);
  const [clearingProvider, setClearingProvider] = useState<CloudAgentKind | null>(null);
  const canManageCloudCredentials = authStatus === "authenticated" && !isDevAuthBypassed();
  const cloudRepositories = repositories.filter(isCloudRepository);
  const repoConfigMap = useMemo(
    () => new Map<string, CloudRepoConfigSummary>(
      (repoConfigs?.configs ?? []).map((config) => [
        cloudRepositoryKey(config.gitOwner, config.gitRepoName),
        config,
      ]),
    ),
    [repoConfigs?.configs],
  );
  const credentialStatusMap = useMemo(() => {
    const statusMap = new Map<CloudAgentKind, CloudCredentialStatus>();
    for (const status of credentialStatuses) {
      if (isCloudAgentKind(status.provider)) {
        statusMap.set(status.provider, status);
      }
    }
    return statusMap;
  }, [credentialStatuses]);
  const syncableCredentialCount = credentialStatuses.filter((status) => (
    status.localDetected || status.synced
  )).length;
  const configuredEnvironmentCount = cloudRepositories.filter((repository) => {
    const repoKey = cloudRepositoryKey(repository.gitOwner, repository.gitRepoName);
    return repoConfigMap.get(repoKey)?.configured;
  }).length;
  const automaticSyncDescription = `${formatCount(
    syncableCredentialCount,
    "agent credential",
  )} + ${formatCount(
    configuredEnvironmentCount,
    "repo tracked-file set",
  )}`;

  const rows = CLOUD_CREDENTIAL_PROVIDER_ORDER.map((provider) => {
    const status = credentialStatusMap.get(provider);
    return {
      provider,
      status,
      label: getProviderDisplayName(provider),
      description: describeCloudCredentialStatus(provider, status),
    };
  });

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Cloud"
        description="Cloud access, syncing, and environment configuration."
      />

      {billingPlan && (
        <CloudPaneSection title="Access">
          <CloudBillingSummary
            billingPlan={billingPlan}
            billingActions={billingActions}
          />
        </CloudPaneSection>
      )}

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

      <CloudPaneSection title="Manual sync">
        <SettingsCard>
          {rows.map((row) => {
            const status = row.status;
            const syncing = syncingProvider === row.provider;
            const clearing = clearingProvider === row.provider;
            const requiresSignIn = !canManageCloudCredentials && Boolean(status?.localDetected);
            const syncDisabled = syncing
              || (requiresSignIn && signingIn)
              || (!canManageCloudCredentials && !status?.localDetected)
              || (!status?.localDetected && !status?.synced);
            const clearDisabled = clearing || !canManageCloudCredentials || !status?.synced;
            const syncLabel = requiresSignIn
              ? signingIn
                ? AUTH_ACCOUNT_LABELS.signingIn
                : AUTH_ACCOUNT_LABELS.signIn
              : syncing
                ? AUTH_ACCOUNT_LABELS.syncing
                : AUTH_ACCOUNT_LABELS.sync;

            return (
              <SettingsCardRow
                key={row.provider}
                label={row.label}
                description={row.description}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${status?.synced ? "text-foreground" : "text-muted-foreground"}`}>
                    {status?.synced ? "Synced to cloud" : status?.localDetected ? "Available locally" : "Not detected"}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={syncDisabled}
                    loading={requiresSignIn ? signingIn : syncing}
                    onClick={() => {
                      if (requiresSignIn) {
                        void signInWithGitHub();
                        return;
                      }
                      setSyncingProvider(row.provider);
                      void syncCloudCredential(row.provider)
                        .catch(() => undefined)
                        .finally(() => setSyncingProvider(null));
                    }}
                  >
                    {syncLabel}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={clearDisabled}
                    onClick={() => {
                      setClearingProvider(row.provider);
                      void deleteCloudCredential(row.provider)
                        .catch(() => undefined)
                        .finally(() => setClearingProvider(null));
                    }}
                  >
                    {clearing ? AUTH_ACCOUNT_LABELS.clearing : AUTH_ACCOUNT_LABELS.clear}
                  </Button>
                </div>
              </SettingsCardRow>
            );
          })}
        </SettingsCard>
      </CloudPaneSection>

      {signInError && !canManageCloudCredentials && (
        <p className="text-sm text-destructive">{signInError}</p>
      )}

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
