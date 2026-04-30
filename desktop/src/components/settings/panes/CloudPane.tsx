import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { AUTH_ACCOUNT_LABELS } from "@/config/auth";
import { CLOUD_CREDENTIAL_PROVIDER_ORDER } from "@/config/cloud-providers";
import { getProviderDisplayName } from "@/config/providers";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import { describeCloudCredentialStatus } from "@/lib/domain/cloud/credentials";
import {
  buildSettingsHref,
} from "@/lib/domain/settings/navigation";
import {
  descriptionForStartBlockReason,
  titleForStartBlockReason,
} from "@/lib/domain/workspaces/cloud-workspace-status";
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
import type { RuntimeInputSyncStatus } from "@/lib/domain/cloud/runtime-input-sync";
import { useAuthStore } from "@/stores/auth/auth-store";
import { openExternal } from "@/platform/tauri/shell";

const EMPTY_CLOUD_CREDENTIAL_STATUSES: CloudCredentialStatus[] = [];

const RUNTIME_INPUT_STATUS_LABELS: Record<RuntimeInputSyncStatus, string> = {
  not_configured: "Not configured",
  local_only: "Available locally",
  syncing: "Syncing",
  synced_to_cloud: "Synced to cloud",
  manual_sync: "Manual resync",
  sync_failed: "Sync issue",
};

const RUNTIME_INPUT_STATUS_CLASSES: Record<RuntimeInputSyncStatus, string> = {
  not_configured: "border-border/50 bg-muted/40 text-muted-foreground",
  local_only: "border-border/50 bg-muted/40 text-foreground",
  syncing: "border-border/50 bg-muted/40 text-foreground",
  synced_to_cloud: "border-border/50 bg-muted/40 text-foreground",
  manual_sync: "border-border/50 bg-muted/40 text-muted-foreground",
  sync_failed: "border-border/60 bg-muted/40 text-foreground",
};

function formatSandboxHours(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Unlimited";
  }

  const rounded = Math.round(Math.max(value, 0) * 100) / 100;
  const formatted = rounded.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
  });
  return `${formatted} ${rounded === 1 ? "hour" : "hours"}`;
}

function formatActiveSandboxes(
  activeSandboxCount: number,
  concurrentSandboxLimit: number | null,
): string {
  if (concurrentSandboxLimit === null) {
    return `${activeSandboxCount.toLocaleString()} active`;
  }

  return `${activeSandboxCount.toLocaleString()} of ${concurrentSandboxLimit.toLocaleString()}`;
}

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
        description="Usage and credential sync for cloud workspaces."
      />

      {billingPlan && (
        <SettingsCard>
          <div className="space-y-3 p-3 text-sm">
            <div className="rounded-lg border border-border bg-foreground/5 px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {billingPlan.isUnlimited
                      ? "Unlimited cloud enabled"
                      : billingPlan.isPaidCloud
                        ? "$200/month Cloud"
                        : "Free cloud credits"}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {billingPlan.isUnlimited
                      ? "No sandbox-hour limit is enforced for this account."
                      : billingPlan.isPaidCloud
                      ? "Monthly credits and refills are consumed before overage."
                      : "Running cloud sandboxes consume free credits."}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {billingPlan.isPaidCloud ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        loading={billingActions.creatingBillingPortal}
                        onClick={() => {
                          void billingActions.createBillingPortal().catch(() => undefined);
                        }}
                      >
                        Manage billing
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        loading={billingActions.creatingRefillCheckout}
                        onClick={() => {
                          void billingActions.createRefillCheckout().catch(() => undefined);
                        }}
                      >
                        Refill 10h
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      loading={billingActions.creatingCloudCheckout}
                      onClick={() => {
                        void billingActions.createCloudCheckout().catch(() => undefined);
                      }}
                    >
                      Upgrade
                    </Button>
                  )}
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    {billingPlan.isUnlimited
                      ? "Remaining"
                      : billingPlan.isPaidCloud
                        ? "Prepaid remaining"
                        : "Free remaining"}
                  </dt>
                  <dd className="mt-1 font-medium text-foreground">
                    {formatSandboxHours(billingPlan.remainingSandboxHours)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    Used
                  </dt>
                  <dd className="mt-1 font-medium text-foreground">
                    {formatSandboxHours(billingPlan.usedSandboxHours)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    {billingPlan.isUnlimited
                      ? "Included total"
                      : billingPlan.isPaidCloud
                        ? "Prepaid total"
                        : "Free total"}
                  </dt>
                  <dd className="mt-1 font-medium text-foreground">
                    {formatSandboxHours(billingPlan.freeSandboxHours)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    Active sandboxes
                  </dt>
                  <dd className="mt-1 font-medium text-foreground">
                    {formatActiveSandboxes(
                      billingPlan.activeSandboxCount,
                      billingPlan.concurrentSandboxLimit,
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            {billingPlan.isPaidCloud && !billingPlan.isUnlimited && (
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {billingPlan.overageEnabled ? "Overage billing on" : "Overage billing off"}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {billingPlan.overageEnabled
                        ? "Additional usage is billed at $2/hour in 10-hour blocks."
                        : "Cloud pauses when included/refill hours run out."}
                    </p>
                  </div>
                  <Switch
                    aria-label="Toggle cloud overage billing"
                    checked={billingPlan.overageEnabled}
                    disabled={billingActions.updatingOverage}
                    onChange={(enabled) => {
                      void billingActions.updateOverageEnabled(enabled).catch(() => undefined);
                    }}
                  />
                </div>
              </div>
            )}

            {billingPlan.hostedInvoiceUrl && (
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-muted-foreground">
                    Cloud usage is paused because billing needs attention.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { void openExternal(billingPlan.hostedInvoiceUrl!); }}
                  >
                    View invoice
                  </Button>
                </div>
              </div>
            )}

            {billingPlan.billingMode === "enforce" && billingPlan.startBlocked && (
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="font-medium text-foreground">
                  {titleForStartBlockReason(billingPlan.startBlockReason)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {descriptionForStartBlockReason(billingPlan.startBlockReason)}
                </p>
              </div>
            )}
          </div>
        </SettingsCard>
      )}

      <SettingsCard>
        <SettingsCardRow
          label="Runtime input sync"
          description="Keep agent credentials and API-key Powers synced to cloud in the background. Repo tracked files can be manually resynced from repo settings."
        >
          <Switch
            checked={runtimeInputSync.enabled}
            onChange={runtimeInputSync.setEnabled}
            aria-label="Start runtime input sync"
          />
        </SettingsCardRow>
        {runtimeInputSync.rows.map((row) => (
          <SettingsCardRow
            key={row.id}
            label={row.label}
            description={row.description}
          >
            <Badge className={RUNTIME_INPUT_STATUS_CLASSES[row.status]}>
              {RUNTIME_INPUT_STATUS_LABELS[row.status]}
            </Badge>
          </SettingsCardRow>
        ))}
      </SettingsCard>

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

      {signInError && !canManageCloudCredentials && (
        <p className="text-sm text-destructive">{signInError}</p>
      )}

      <SettingsCard>
        <div className="space-y-1.5 p-3">
          <p className="text-sm font-medium text-foreground">Repo cloud settings</p>
          <p className="text-sm text-muted-foreground">
            Configure tracked files, repo env vars, and a cloud-only setup script for each GitHub repo.
          </p>
        </div>
        {cloudRepositories.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No GitHub-backed local repositories are available yet.
          </div>
        ) : (
          cloudRepositories.map((repository) => {
            const repoKey = cloudRepositoryKey(repository.gitOwner, repository.gitRepoName);
            const config = repoConfigMap.get(repoKey);

            return (
              <SettingsCardRow
                key={repoKey}
                label={repository.name}
                description={repository.secondaryLabel ?? `${repository.gitOwner}/${repository.gitRepoName}`}
              >
                <div className="flex items-center gap-2">
                  <Badge>{config?.configured ? "Saved for cloud" : "Not saved yet"}</Badge>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate(
                      buildSettingsHref({
                        section: "repo",
                        repo: repository.sourceRoot,
                      }),
                    )}
                  >
                    {config?.configured ? "Manage" : "Configure cloud"}
                  </Button>
                </div>
              </SettingsCardRow>
            );
          })
        )}
      </SettingsCard>
    </section>
  );
}
