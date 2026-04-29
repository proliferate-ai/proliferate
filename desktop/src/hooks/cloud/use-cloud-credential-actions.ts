import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CloudAgentKind } from "@/lib/integrations/cloud/client";
import { ProliferateClientError } from "@/lib/integrations/cloud/client";
import {
  deleteCloudCredential,
} from "@/lib/integrations/cloud/credentials";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { getProviderDisplayName } from "@/config/providers";
import { cloudCredentialsKey } from "./query-keys";
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
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const showToast = useToastStore((state) => state.show);

  const syncMutation = useMutation<void, Error, CloudAgentKind>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (provider) => {
      await syncLocalCloudCredentialToCloud(provider);
    },
    onSuccess: async (_result, provider) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cloudCredentialsKey() }),
        queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        }),
      ]);
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

  const deleteMutation = useMutation<void, Error, CloudAgentKind>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (provider) => {
      await deleteCloudCredential(provider);
    },
    onSuccess: async (_result, provider) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cloudCredentialsKey() }),
        queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        }),
      ]);
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
