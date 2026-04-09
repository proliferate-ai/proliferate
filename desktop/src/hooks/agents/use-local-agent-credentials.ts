import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configuredAgentEnvVarsKey } from "./query-keys";
import {
  deleteEnvVarSecret,
  listConfiguredEnvVarNames,
  setEnvVarSecret,
} from "@/platform/tauri/credentials";
import { useAgentCredentialsStore } from "@/stores/agents/agent-credentials-store";

const EMPTY_CONFIGURED_ENV_VARS: string[] = [];

async function readConfiguredEnvVarNames() {
  try {
    return await listConfiguredEnvVarNames();
  } catch {
    return EMPTY_CONFIGURED_ENV_VARS;
  }
}

export function useLocalAgentCredentials() {
  const queryClient = useQueryClient();
  const markRestartRequired = useAgentCredentialsStore((state) => state.markRestartRequired);

  const configuredEnvVarsQuery = useQuery({
    queryKey: configuredAgentEnvVarsKey(),
    queryFn: readConfiguredEnvVarNames,
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
    onSuccess: async () => {
      await invalidateConfiguredEnvVars();
      markRestartRequired();
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: async (name: string) => {
      await deleteEnvVarSecret(name);
    },
    onSuccess: async () => {
      await invalidateConfiguredEnvVars();
      markRestartRequired();
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
