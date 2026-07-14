import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { configuredAgentEnvVarsKey } from "./query-keys";
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
  const credentials = useProductHost().desktop?.localCredentials ?? null;
  const markRestartRequired = useAgentCredentialsStore((state) => state.markRestartRequired);

  const configuredEnvVarsQuery = useQuery({
    queryKey: configuredAgentEnvVarsKey(),
    queryFn: () => credentials
      ? readConfiguredEnvVarNames(credentials.listConfigured)
      : Promise.resolve(EMPTY_CONFIGURED_ENV_VARS),
    enabled: credentials !== null,
    staleTime: Infinity,
  });

  const invalidateConfiguredEnvVars = async () => {
    await queryClient.invalidateQueries({
      queryKey: configuredAgentEnvVarsKey(),
    });
  };

  const saveCredentialMutation = useMutation({
    mutationFn: async ({ name, value }: { name: string; value: string }) => {
      if (!credentials) {
        throw new Error("Local agent credentials are only available in Desktop.");
      }
      await credentials.set(name, value);
    },
    onSuccess: async () => {
      await invalidateConfiguredEnvVars();
      markRestartRequired();
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!credentials) {
        throw new Error("Local agent credentials are only available in Desktop.");
      }
      await credentials.remove(name);
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
