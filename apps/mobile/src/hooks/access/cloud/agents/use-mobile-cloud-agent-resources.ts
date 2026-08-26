import type {
  CloudHarnessLaunchOptionsResponse,
} from "@proliferate/product-client/internal/domain/chats/cloud/launch-options-model";

// The cloud sandbox stack is deleted: there is no copied launch-options
// observation to read for a cloud chat any more. The query surface stays
// inert so composer controls render without model options.
export function useMobileCloudAgentResources(_input: {
  cloudSandboxId: string | null | undefined;
  harnessKind: string | null | undefined;
}) {
  const launchOptions = {
    data: undefined as CloudHarnessLaunchOptionsResponse | undefined,
    error: null as Error | null,
    isError: false,
    isLoading: false,
  };

  return {
    launchOptions,
  };
}
