import type { QueryClient } from "@tanstack/react-query";
import type { CloudCommandResponse } from "@proliferate/cloud-sdk";
import { cloudCommandKey } from "./query-keys.js";

export function setCloudCommandStatusCache(
  queryClient: QueryClient,
  command: CloudCommandResponse,
): void {
  queryClient.setQueryData(cloudCommandKey(command.commandId), command);
}

