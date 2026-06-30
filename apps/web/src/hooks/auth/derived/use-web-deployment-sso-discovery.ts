import { discoverSso, type SsoDiscoveryResponse } from "@proliferate/cloud-sdk";
import { useCloudClient } from "@proliferate/cloud-sdk-react";
import { useQuery } from "@tanstack/react-query";

import { webEnv } from "../../../config/env";

export function useWebDeploymentSsoDiscovery() {
  const client = useCloudClient();
  return useQuery<SsoDiscoveryResponse>({
    queryKey: ["web", "auth", "deployment-sso", webEnv.apiBaseUrl],
    queryFn: () => discoverSso({}, client),
    staleTime: 15_000,
    retry: 1,
  });
}
