import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useAddRepo } from "#product/hooks/workspaces/workflows/use-add-repo";
import { useCloudRepositoryIntentStore } from "#product/stores/cloud/cloud-repository-intent-store";
import { useToastStore } from "#product/stores/toast/toast-store";

interface RepoAvailabilityTarget {
  gitOwner: string;
  gitRepoName: string;
}

/**
 * The per-repo availability actions the sidebar's repository groups expose:
 * "Set up in Cloud" (begins a cloud repository intent) and "Add to this Mac"
 * (Desktop-only native folder pick with an identity check before any mutation).
 * Extracted from MainSidebar so the shell component stays a composition root
 * rather than an action-owner; also carries the host-derived flags those
 * groups render against (isDesktopHost, managedCloudAvailable).
 */
export function useSidebarRepoAvailabilityActions() {
  const capabilities = useAppCapabilities();
  const host = useProductHost();
  const files = host.desktop?.files ?? null;
  const isDesktopHost = Boolean(host.desktop);
  const managedCloudAvailable = capabilities.managedCloudStatus !== "disabled";
  const showToast = useToastStore((state) => state.show);
  const { addRepoFromPath } = useAddRepo();
  const beginCloudRepositoryIntent = useCloudRepositoryIntentStore((state) => state.begin);

  const handleSetUpCloud = useCallback((target: RepoAvailabilityTarget) => {
    beginCloudRepositoryIntent({
      kind: "set_up_cloud",
      repo: { gitProvider: "github", gitOwner: target.gitOwner, gitRepoName: target.gitRepoName },
    });
  }, [beginCloudRepositoryIntent]);

  const handleAddToThisMac = useCallback((target: RepoAvailabilityTarget) => {
    // Add to this Mac: pick a folder, then register it only if it proves to be
    // the expected GitHub repository (identity check runs before any mutation).
    void (async () => {
      if (!files) {
        return;
      }
      const path = await files.pickDirectory();
      if (!path) {
        return;
      }
      const result = await addRepoFromPath(path, {
        expectedRepoIdentity: {
          gitProvider: "github",
          gitOwner: target.gitOwner,
          gitRepoName: target.gitRepoName,
        },
      });
      if (!result.succeeded) {
        showToast(result.error);
      }
    })();
  }, [addRepoFromPath, files, showToast]);

  return {
    isDesktopHost,
    managedCloudAvailable,
    handleSetUpCloud,
    handleAddToThisMac,
  };
}
