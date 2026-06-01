import {
  useAgentAuthCredentials,
  useCloudAgentCatalog,
  useCloudCapabilities,
} from "@proliferate/cloud-sdk-react";

export function useMobileCloudAgentResources() {
  const agentCatalog = useCloudAgentCatalog();
  const cloudCapabilities = useCloudCapabilities();
  const agentAuthCredentials = useAgentAuthCredentials();

  return {
    agentCatalog,
    cloudCapabilities,
    agentAuthCredentials,
  };
}
