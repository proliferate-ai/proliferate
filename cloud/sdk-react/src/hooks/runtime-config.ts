import { useQuery } from "@tanstack/react-query";
import {
  getSandboxProfileRuntimeConfig,
  type RuntimeConfigStatusResponse,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import { sandboxProfileRuntimeConfigKey } from "../lib/query-keys.js";

export function useSandboxProfileRuntimeConfig(
  sandboxProfileId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<RuntimeConfigStatusResponse>({
    queryKey: sandboxProfileRuntimeConfigKey(sandboxProfileId),
    queryFn: () => getSandboxProfileRuntimeConfig(sandboxProfileId!, client),
    enabled: enabled && sandboxProfileId !== null,
  });
}
