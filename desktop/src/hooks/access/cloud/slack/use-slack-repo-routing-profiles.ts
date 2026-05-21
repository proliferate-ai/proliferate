import "@/lib/access/cloud/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listSlackRepoRoutingProfiles,
  upsertSlackRepoRoutingProfile,
} from "@proliferate/cloud-sdk/client/slack";
import type {
  SlackRepoRoutingProfilesResponse,
  UpsertSlackRepoRoutingProfileRequest,
} from "@/lib/access/cloud/client";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { slackRepoRoutingProfilesKey } from "@/hooks/access/cloud/slack/query-keys";

export function useSlackRepoRoutingProfiles(
  organizationId: string | null,
  enabled = true,
) {
  const { cloudActive } = useCloudAvailabilityState();

  return useQuery<SlackRepoRoutingProfilesResponse>({
    queryKey: slackRepoRoutingProfilesKey(organizationId),
    enabled: enabled && cloudActive && organizationId !== null,
    queryFn: () => listSlackRepoRoutingProfiles(organizationId!),
  });
}

export function useSlackRepoRoutingProfileMutation(
  organizationId: string | null,
) {
  const queryClient = useQueryClient();

  return useMutation<
    SlackRepoRoutingProfilesResponse,
    Error,
    { profileId: string; body: UpsertSlackRepoRoutingProfileRequest }
  >({
    mutationFn: ({ body }) => upsertSlackRepoRoutingProfile(organizationId!, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: slackRepoRoutingProfilesKey(organizationId),
      });
    },
  });
}
