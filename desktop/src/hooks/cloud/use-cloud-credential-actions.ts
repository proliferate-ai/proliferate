import { useCallback } from "react";
import type { CloudAgentKind } from "@/lib/access/cloud/client";
import { ProliferateClientError } from "@/lib/access/cloud/client";
import { getProviderDisplayName } from "@/lib/domain/agents/provider-display";
import { useCloudCredentialMutations } from "@/hooks/access/cloud/use-cloud-credential-mutations";
import { useToastStore } from "@/stores/toast/toast-store";

function describeCloudCredentialActionFailure(
  action: "sync" | "clear",
  provider: CloudAgentKind,
  error: Error,
): string {
  if (error instanceof ProliferateClientError) {
    return error.message;
  }

  const providerLabel = getProviderDisplayName(provider);
  return action === "sync"
    ? `Failed to sync ${providerLabel} credentials.`
    : `Failed to clear ${providerLabel} credentials.`;
}

export function useCloudCredentialActions() {
  const credentialMutations = useCloudCredentialMutations();
  const showToast = useToastStore((state) => state.show);

  const syncCloudCredential = useCallback(async (provider: CloudAgentKind) => {
    try {
      return await credentialMutations.syncCloudCredential(provider);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      showToast(describeCloudCredentialActionFailure("sync", provider, normalizedError));
      throw error;
    }
  }, [credentialMutations.syncCloudCredential, showToast]);

  const deleteCloudCredential = useCallback(async (provider: CloudAgentKind) => {
    try {
      return await credentialMutations.deleteCloudCredential(provider);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      showToast(describeCloudCredentialActionFailure("clear", provider, normalizedError));
      throw error;
    }
  }, [credentialMutations.deleteCloudCredential, showToast]);

  return {
    syncCloudCredential,
    isSyncingCloudCredential: credentialMutations.isSyncingCloudCredential,
    deleteCloudCredential,
    isDeletingCloudCredential: credentialMutations.isDeletingCloudCredential,
  };
}
