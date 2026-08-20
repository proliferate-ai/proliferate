import {
  useCloudHarnessLaunchOptions,
} from "@proliferate/cloud-sdk-react";

export function useMobileCloudAgentResources(input: {
  cloudSandboxId: string | null | undefined;
  harnessKind: string | null | undefined;
}) {
  const launchOptions = useCloudHarnessLaunchOptions(input);

  return {
    launchOptions,
  };
}
