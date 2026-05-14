import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudAgentKind,
  CloudCredentialMutationResponse,
} from "@/lib/access/cloud/client";
import { deleteCloudCredential } from "@proliferate/cloud-sdk/client/credentials";
import { syncLocalCloudCredentialToCloud } from "@/lib/access/cloud/credential-sync";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  cloudCredentialsKey,
  isCloudWorkspaceConnectionQueryKey,
} from "@/hooks/access/cloud/query-keys";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/cache/query-keys";

async function invalidateCloudCredentialState(
  input: {
    queryClient: QueryClient;
    runtimeUrl: string;
    result: CloudCredentialMutationResponse;
  },
): Promise<void> {
  const invalidations: Promise<unknown>[] = [
    input.queryClient.invalidateQueries({ queryKey: cloudCredentialsKey() }),
  ];
  if (input.result.changed) {
    invalidations.push(
      input.queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(input.runtimeUrl),
      }),
      input.queryClient.invalidateQueries({
        predicate: (query) => isCloudWorkspaceConnectionQueryKey(query.queryKey),
      }),
    );
  }
  await Promise.all(invalidations);
}

export function useCloudCredentialMutations() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

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
      await invalidateCloudCredentialState({ queryClient, runtimeUrl, result });
      trackProductEvent("cloud_credential_synced", {
        provider,
      });
    },
    onError: (error, provider) => {
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
      await invalidateCloudCredentialState({ queryClient, runtimeUrl, result });
      trackProductEvent("cloud_credential_deleted", {
        provider,
      });
    },
    onError: (error, provider) => {
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
