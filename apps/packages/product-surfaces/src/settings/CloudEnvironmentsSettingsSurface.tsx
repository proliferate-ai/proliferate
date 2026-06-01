import { useMemo, useState } from "react";
import { useCloudRepoConfigs } from "@proliferate/cloud-sdk-react";
import {
  buildCloudEnvironmentListItems,
} from "@proliferate/product-domain/environments/cloud-environments";
import { formatGitRepoId, parseGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import { CloudEnvironmentList } from "@proliferate/product-ui/environments/CloudEnvironmentList";
import { AddCloudEnvironmentDialogController } from "./cloud-environments/AddCloudEnvironmentDialogController";
import { CloudEnvironmentDetail } from "./cloud-environments/CloudEnvironmentDetail";

export interface LocalCheckoutView {
  id: string;
  name: string;
  description: string;
  gitOwner?: string | null;
  gitRepoName?: string | null;
}

export interface CloudEnvironmentRepoSelection {
  gitOwner: string;
  gitRepoName: string;
}

export interface CloudEnvironmentsSettingsSurfaceProps {
  mode: "cloud-only" | "hybrid";
  localCheckouts?: readonly LocalCheckoutView[];
  selectedCloudRepo?: CloudEnvironmentRepoSelection | null;
  enabled?: boolean;
  cloudUnavailableReason?: string | null;
  onSelectCloudEnvironment: (repo: CloudEnvironmentRepoSelection) => void;
  onSelectLocalCheckout?: (sourceRoot: string) => void;
  onBackToList: () => void;
}

export function CloudEnvironmentsSettingsSurface({
  mode,
  localCheckouts = [],
  selectedCloudRepo = null,
  enabled = true,
  cloudUnavailableReason = null,
  onSelectCloudEnvironment,
  onSelectLocalCheckout,
  onBackToList,
}: CloudEnvironmentsSettingsSurfaceProps) {
  const [addOpen, setAddOpen] = useState(false);
  const repoConfigs = useCloudRepoConfigs(enabled);
  const localCheckoutsForDomain = useMemo(
    () => localCheckouts
      .filter((checkout) => checkout.gitOwner && checkout.gitRepoName)
      .map((checkout) => ({
        gitOwner: checkout.gitOwner!,
        gitRepoName: checkout.gitRepoName!,
        sourceRoot: checkout.id,
        name: checkout.name,
        secondaryLabel: checkout.description,
      })),
    [localCheckouts],
  );
  const cloudConfigByRepoId = useMemo(() => {
    const byId = new Map<string, { configured: boolean }>();
    for (const config of repoConfigs.data?.configs ?? []) {
      byId.set(formatGitRepoId({
        gitOwner: config.gitOwner,
        gitRepoName: config.gitRepoName,
      }), config);
    }
    return byId;
  }, [repoConfigs.data?.configs]);
  const cloudEnvironmentItems = useMemo(() => buildCloudEnvironmentListItems({
    configs: repoConfigs.data?.configs ?? [],
    localCheckouts: localCheckoutsForDomain,
  }), [localCheckoutsForDomain, repoConfigs.data?.configs]);

  if (selectedCloudRepo && enabled) {
    return (
      <CloudEnvironmentDetail
        gitOwner={selectedCloudRepo.gitOwner}
        gitRepoName={selectedCloudRepo.gitRepoName}
        enabled={enabled}
        onBack={onBackToList}
        onSaved={() => {
          void repoConfigs.refetch();
        }}
      />
    );
  }

  const resolvedCloudUnavailableReason = cloudUnavailableReason
    ?? (repoConfigs.isError ? "Cloud environments could not be loaded." : null);

  return (
    <>
      <CloudEnvironmentList
        title="Environments"
        description={mode === "hybrid"
          ? "Configure local checkouts and personal Cloud environments."
          : "Personal Cloud environments are GitHub repositories Proliferate can run without a local clone."}
        localCheckouts={mode === "hybrid" ? localCheckouts.map((checkout) => {
          const repoId = checkout.gitOwner && checkout.gitRepoName
            ? formatGitRepoId({
                gitOwner: checkout.gitOwner,
                gitRepoName: checkout.gitRepoName,
              })
            : null;
          const cloudConfig = repoId ? cloudConfigByRepoId.get(repoId) : null;
          return {
            id: checkout.id,
            name: checkout.name,
            description: checkout.description,
            cloudStatusLabel: cloudConfig
              ? cloudConfig.configured
                ? "Cloud enabled"
                : "Cloud disabled"
              : null,
          };
        }) : undefined}
        cloudEnvironments={cloudEnvironmentItems.map((environment) => ({
          id: environment.id,
          fullName: environment.fullName,
          description: environment.description,
          configured: environment.configured,
          localState: environment.localState,
          trackedFileCount: null,
        }))}
        loadingCloudEnvironments={enabled && repoConfigs.isLoading}
        cloudUnavailableReason={resolvedCloudUnavailableReason}
        onSelectLocalCheckout={mode === "hybrid" ? onSelectLocalCheckout : undefined}
        onSelectCloudEnvironment={(repoId) => {
          const parsed = parseGitRepoId(repoId);
          if (parsed) {
            onSelectCloudEnvironment(parsed);
          }
        }}
        onAddCloudEnvironment={enabled ? () => setAddOpen(true) : undefined}
        onRetryCloudEnvironments={enabled && repoConfigs.isError
          ? () => {
              void repoConfigs.refetch();
            }
          : undefined}
      />
      <AddCloudEnvironmentDialogController
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onEnvironmentAdded={(repoId) => {
          const parsed = parseGitRepoId(repoId);
          if (parsed) {
            onSelectCloudEnvironment(parsed);
          }
          void repoConfigs.refetch();
        }}
      />
    </>
  );
}
