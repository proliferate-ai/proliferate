import "@/lib/access/cloud/client";
import { useQuery } from "@tanstack/react-query";
import { listSlackChannels } from "@proliferate/cloud-sdk/client/slack";
import type { SlackChannelsResponse } from "@/lib/access/cloud/client";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { slackChannelsKey } from "@/hooks/access/cloud/slack/query-keys";

export function useSlackChannels(
  organizationId: string | null,
  enabled = true,
) {
  const { cloudActive } = useCloudAvailabilityState();

  return useQuery<SlackChannelsResponse>({
    queryKey: slackChannelsKey(organizationId),
    enabled: enabled && cloudActive && organizationId !== null,
    queryFn: () => listSlackChannels(organizationId!),
  });
}
