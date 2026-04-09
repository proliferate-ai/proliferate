import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { SupportDialog } from "@/components/support/SupportDialog";
import { AUTH_ACCOUNT_LABELS } from "@/config/auth";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import {
  buildCloudRepoSettingsHref,
} from "@/lib/domain/settings/navigation";
import {
  cloudRepositoryKey,
  isCloudRepository,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { useGitHubSignIn } from "@/hooks/auth/use-github-sign-in";
import { useCloudBilling } from "@/hooks/cloud/use-cloud-billing";
import { useCloudCredentialActions } from "@/hooks/cloud/use-cloud-credential-actions";
import { useCloudCredentials } from "@/hooks/cloud/use-cloud-credentials";
import { useCloudRepoConfigs } from "@/hooks/cloud/use-cloud-repo-configs";
import type { CloudCredentialStatus, CloudRepoConfigSummary } from "@/lib/integrations/cloud/client";
import { useAuthStore } from "@/stores/auth/auth-store";

const EMPTY_CLOUD_CREDENTIAL_STATUSES: CloudCredentialStatus[] = [];

interface CloudPaneProps {
  repositories: SettingsRepositoryEntry[];
}

export function CloudPane({ repositories }: CloudPaneProps) {
  const navigate = useNavigate();
  const { data: credentialStatuses = EMPTY_CLOUD_CREDENTIAL_STATUSES } = useCloudCredentials();
  const { data: billingPlan } = useCloudBilling();
  const { data: repoConfigs } = useCloudRepoConfigs();
  const { syncCloudCredential, deleteCloudCredential } = useCloudCredentialActions();
  const {
    signIn: signInWithGitHub,
    submitting: signingIn,
    error: signInError,
  } = useGitHubSignIn();
  const authStatus = useAuthStore((state) => state.status);
  const [syncingProvider, setSyncingProvider] = useState<"claude" | "codex" | null>(null);
  const [clearingProvider, setClearingProvider] = useState<"claude" | "codex" | null>(null);
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [unlimitedDialogOpen, setUnlimitedDialogOpen] = useState(false);
  const canManageCloudCredentials = authStatus === "authenticated" && !isDevAuthBypassed();
  const alreadyUnlimited = billingPlan?.isUnlimited ?? false;
  const upgradeCardTitle = alreadyUnlimited ? "Need team features?" : "Upgrade to Pro";
  const upgradeCardDescription = alreadyUnlimited
    ? "You already have unlimited cloud. If you want team features or white-glove support, reach out to Pablo directly."
    : "Team features, unlimited cloud, and white-glove support. Listed as $500/mo, but there is no self-serve billing flow right now because we’re trying to keep as much as possible free and open source.";
  const upgradeButtonLabel = alreadyUnlimited ? "Ask about team features" : "Ask about Pro";
  const upgradeDefaultMessage = alreadyUnlimited
    ? "I already have unlimited cloud and want to talk about team features / white-glove support."
    : "I want to talk about Pro / team features and unlimited cloud.";
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

  const rows = [
    {
      provider: "claude" as const,
      label: "Claude",
      description: credentialStatuses.find((status) => status.provider === "claude")?.authMode === "file"
        ? "Synced via Claude Code local auth."
        : credentialStatuses.find((status) => status.provider === "claude")?.synced
          ? "Synced via ANTHROPIC_API_KEY."
          : "Sync your ANTHROPIC_API_KEY or Claude Code login for cloud workspaces.",
    },
    {
      provider: "codex" as const,
      label: "Codex",
      description: "Sync your local ~/.codex/auth.json for cloud workspaces.",
    },
  ];

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Cloud"
        description="Usage and credential sync for cloud workspaces."
      />

      {billingPlan && (
        <SettingsCard>
          <div className="space-y-3 p-3 text-sm">
            {billingPlan.isUnlimited ? (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="font-medium text-foreground">Unlimited cloud enabled</p>
                <p className="mt-1 text-muted-foreground">
                  Usage is still tracked for visibility. {billingPlan.activeSandboxCount}/{billingPlan.concurrentSandboxLimit} cloud sandboxes are active right now.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="font-medium text-foreground">
                  {(billingPlan.remainingSandboxHours ?? 0).toFixed(2)} free hours remaining
                </p>
                <p className="mt-1 text-muted-foreground">
                  {billingPlan.usedSandboxHours.toFixed(2)} hours used so far.{" "}
                  {billingPlan.activeSandboxCount}/{billingPlan.concurrentSandboxLimit} cloud sandboxes are active right now.
                </p>
              </div>
            )}

            {billingPlan.blocked && (
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="font-medium text-foreground">Cloud usage is paused</p>
                <p className="mt-1 text-muted-foreground">
                  Hosted cloud stays free by default. If you want unlimited cloud usage, reach out to Pablo and we can sort it out directly.
                </p>
                <div className="mt-3">
                  <Button
                    size="sm"
                    onClick={() => setUnlimitedDialogOpen(true)}
                  >
                    Contact Pablo
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SettingsCard>
      )}

      <SettingsCard>
        <div className="space-y-3 p-3">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            <p className="font-medium text-foreground">{upgradeCardTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {upgradeCardDescription}
            </p>
            <div className="mt-3">
              <Button
                size="sm"
                onClick={() => setUpgradeDialogOpen(true)}
              >
                {upgradeButtonLabel}
              </Button>
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard>
        {rows.map((row) => {
          const status = credentialStatuses.find((entry) => entry.provider === row.provider);
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
                <span className={`text-xs ${status?.synced ? "text-primary" : "text-muted-foreground"}`}>
                  {status?.synced ? "Synced" : status?.localDetected ? "Available locally" : "Not detected"}
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
                      buildCloudRepoSettingsHref(repository.gitOwner, repository.gitRepoName),
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

      <SupportDialog
        open={upgradeDialogOpen}
        onClose={() => setUpgradeDialogOpen(false)}
        title={upgradeCardTitle}
        description="There’s no billing page for this. Send a note and Pablo can follow up directly."
        defaultMessage={upgradeDefaultMessage}
        context={{
          source: "settings",
          intent: "team_features",
          pathname: "/settings/cloud",
        }}
      />

      <SupportDialog
        open={unlimitedDialogOpen}
        onClose={() => setUnlimitedDialogOpen(false)}
        title="Unlimited Cloud"
        description="Hosted cloud is free by default. If you want unlimited usage, reach out directly here."
        defaultMessage="I want unlimited cloud usage."
        context={{
          source: "settings",
          intent: "unlimited_cloud",
          pathname: "/settings/cloud",
        }}
      />
    </section>
  );
}
