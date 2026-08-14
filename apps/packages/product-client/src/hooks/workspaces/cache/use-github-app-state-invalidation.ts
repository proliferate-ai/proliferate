import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  githubAppRootKey,
  repositoriesKey,
  useCloudClient,
} from "@proliferate/cloud-sdk-react";

/**
 * Re-read everything a trip to GitHub can have changed.
 *
 * User authorization, the App installation, the accessible-repository catalog
 * and per-repo authority all hang off the GitHub App root; the repository
 * configuration list is the separate key that decides whether a repo already
 * has a Cloud environment. Every surface that sends the user to GitHub — the
 * authorize/install callbacks, and the add-repository flow's manual "Check
 * again" — needs exactly this pair, so the pair is defined once.
 */
export function useGitHubAppStateInvalidation(): () => Promise<void> {
  const queryClient = useQueryClient();
  const client = useCloudClient();

  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: githubAppRootKey(client.baseUrl) }),
      queryClient.invalidateQueries({ queryKey: repositoriesKey() }),
    ]);
  }, [client.baseUrl, queryClient]);
}
