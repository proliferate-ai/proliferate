import { useMutation } from "@tanstack/react-query";
import type {
  CloudWorkspaceMobilityPreflightRequest,
  CloudWorkspaceMobilityPreflightResponse,
} from "@/lib/integrations/cloud/client";
import { preflightCloudWorkspaceHandoff } from "@/lib/integrations/cloud/mobility";

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
