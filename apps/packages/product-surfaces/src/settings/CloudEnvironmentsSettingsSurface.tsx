import { useMemo, useState } from "react";
import { useCloudRepoConfigs } from "@proliferate/cloud-sdk-react";
import {
  buildCloudEnvironmentListItems,
} from "@proliferate/product-domain/environments/cloud-environments";
import { parseGitRepoId } from "@proliferate/product-domain/repos/repo-id";
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
      .map((checkout) => ({
        gitOwner: checkout.gitOwner ?? null,
        gitRepoName: checkout.gitRepoName ?? null,
        sourceRoot: checkout.id,
        name: checkout.name,
        secondaryLabel: checkout.description,
      })),
    [localCheckouts],
  );
  const cloudEnvironmentItems = useMemo(() => buildCloudEnvironmentListItems({
    configs: repoConfigs.data?.configs ?? [],
    localCheckouts: mode === "hybrid" ? localCheckoutsForDomain : [],
  }), [localCheckoutsForDomain, mode, repoConfigs.data?.configs]);

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
        cloudEnvironments={cloudEnvironmentItems.map((environment) => ({
          id: environment.id,
          fullName: environment.fullName,
          description: environment.description,
          configured: environment.configured,
          locationState: environment.locationState,
          localSourceRoot: environment.localSourceRoot,
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
