import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudAgentKind,
  CloudCredentialMutationResponse,
} from "@/lib/integrations/cloud/client";
import { ProliferateClientError } from "@/lib/integrations/cloud/client";
import {
  deleteCloudCredential,
} from "@/lib/integrations/cloud/credentials";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { getProviderDisplayName } from "@/lib/domain/agents/provider-display";
import {
  cloudCredentialsKey,
  isCloudWorkspaceConnectionQueryKey,
} from "./query-keys";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { syncLocalCloudCredentialToCloud } from "./cloud-credential-sync";

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
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const showToast = useToastStore((state) => state.show);

  const syncMutation = useMutation<
    CloudCredentialMutationResponse,
    Error,
    CloudAgentKind
  >({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (provider) => {
      return await syncLocalCloudCredentialToCloud(provider);
    },
    onSuccess: async (result, provider) => {
      const invalidations: Promise<unknown>[] = [
        queryClient.invalidateQueries({ queryKey: cloudCredentialsKey() }),
      ];
      if (result.changed) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: workspaceCollectionsScopeKey(runtimeUrl),
          }),
          queryClient.invalidateQueries({
            predicate: (query) => isCloudWorkspaceConnectionQueryKey(query.queryKey),
          }),
        );
      }
      await Promise.all(invalidations);
      trackProductEvent("cloud_credential_synced", {
        provider,
      });
    },
    onError: (error, provider) => {
      showToast(describeCloudCredentialActionFailure("sync", provider, error));
      captureTelemetryException(error, {
        tags: {
          action: "sync_cloud_credential",
          domain: "cloud_credential",
          provider,
        },
      });
    },
  });

  const deleteMutation = useMutation<
    CloudCredentialMutationResponse,
    Error,
    CloudAgentKind
  >({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (provider) => {
      return await deleteCloudCredential(provider);
    },
    onSuccess: async (result, provider) => {
      const invalidations: Promise<unknown>[] = [
        queryClient.invalidateQueries({ queryKey: cloudCredentialsKey() }),
      ];
      if (result.changed) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: workspaceCollectionsScopeKey(runtimeUrl),
          }),
          queryClient.invalidateQueries({
            predicate: (query) => isCloudWorkspaceConnectionQueryKey(query.queryKey),
          }),
        );
      }
      await Promise.all(invalidations);
      trackProductEvent("cloud_credential_deleted", {
        provider,
      });
    },
    onError: (error, provider) => {
      showToast(describeCloudCredentialActionFailure("clear", provider, error));
      captureTelemetryException(error, {
        tags: {
          action: "delete_cloud_credential",
          domain: "cloud_credential",
          provider,
        },
      });
    },
  });

  return {
    syncCloudCredential: syncMutation.mutateAsync,
    isSyncingCloudCredential: syncMutation.isPending,
    deleteCloudCredential: deleteMutation.mutateAsync,
    isDeletingCloudCredential: deleteMutation.isPending,
  };
}
