import {
  useCloudAgentCatalog,
} from "@proliferate/cloud-sdk-react";

export function useMobileCloudAgentResources() {
  const agentCatalog = useCloudAgentCatalog();

  return {
    agentCatalog,
  };
}
