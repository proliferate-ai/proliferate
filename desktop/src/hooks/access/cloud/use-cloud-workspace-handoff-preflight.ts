import { useMutation } from "@tanstack/react-query";
import type {
  CloudWorkspaceMobilityPreflightRequest,
  CloudWorkspaceMobilityPreflightResponse,
} from "@/lib/access/cloud/client";
import { preflightCloudWorkspaceHandoff } from "@proliferate/cloud-sdk/client/mobility";

export function useCloudWorkspaceHandoffPreflight() {
  return useMutation<
    CloudWorkspaceMobilityPreflightResponse,
    Error,
    {
      mobilityWorkspaceId: string;
      input: CloudWorkspaceMobilityPreflightRequest;
    }
  >({
    mutationFn: ({ mobilityWorkspaceId, input }) =>
      preflightCloudWorkspaceHandoff(mobilityWorkspaceId, input),
  });
}
