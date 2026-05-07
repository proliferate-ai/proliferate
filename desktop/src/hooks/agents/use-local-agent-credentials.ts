import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configuredAgentEnvVarsKey } from "./query-keys";
import {
  useTauriCredentialsActions,
} from "@/hooks/access/tauri/use-credentials-actions";
import { credentialProviderForEnvVar } from "@/lib/domain/cloud/runtime-input-sync";
import { emitRuntimeInputSyncEvent } from "@/hooks/cloud/runtime-input-sync-events";
import { useAgentCredentialsStore } from "@/stores/agents/agent-credentials-store";

const EMPTY_CONFIGURED_ENV_VARS: string[] = [];

async function readConfiguredEnvVarNames(
  listConfiguredEnvVarNames: () => Promise<string[]>,
) {
  try {
    return await listConfiguredEnvVarNames();
  } catch {
    return EMPTY_CONFIGURED_ENV_VARS;
  }
}

export function useLocalAgentCredentials() {
  const queryClient = useQueryClient();
  const {
    deleteEnvVarSecret,
    listConfiguredEnvVarNames,
    setEnvVarSecret,
  } = useTauriCredentialsActions();
  const markRestartRequired = useAgentCredentialsStore((state) => state.markRestartRequired);

  const configuredEnvVarsQuery = useQuery({
    queryKey: configuredAgentEnvVarsKey(),
    queryFn: () => readConfiguredEnvVarNames(listConfiguredEnvVarNames),
    staleTime: Infinity,
  });

  const invalidateConfiguredEnvVars = async () => {
    await queryClient.invalidateQueries({
      queryKey: configuredAgentEnvVarsKey(),
    });
  };

  const saveCredentialMutation = useMutation({
    mutationFn: async ({ name, value }: { name: string; value: string }) => {
      await setEnvVarSecret(name, value);
    },
    onSuccess: async (_result, variables) => {
      await invalidateConfiguredEnvVars();
      markRestartRequired();
      const provider = credentialProviderForEnvVar(variables.name);
      if (provider) {
        emitRuntimeInputSyncEvent({
          trigger: "credential_mutation",
          descriptors: [{ kind: "credential", provider }],
        });
      }
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: async (name: string) => {
      await deleteEnvVarSecret(name);
    },
    onSuccess: async (_result, name) => {
      await invalidateConfiguredEnvVars();
      markRestartRequired();
      const provider = credentialProviderForEnvVar(name);
      if (provider) {
        emitRuntimeInputSyncEvent({
          trigger: "credential_mutation",
          descriptors: [{ kind: "credential", provider }],
        });
      }
    },
  });

  return {
    configuredEnvVarNames:
      configuredEnvVarsQuery.data ?? EMPTY_CONFIGURED_ENV_VARS,
    isLoadingConfiguredEnvVarNames: configuredEnvVarsQuery.isLoading,
    saveCredential: async (name: string, value: string) =>
      saveCredentialMutation.mutateAsync({ name, value }),
    deleteCredential: async (name: string) =>
      deleteCredentialMutation.mutateAsync(name),
  };
}
