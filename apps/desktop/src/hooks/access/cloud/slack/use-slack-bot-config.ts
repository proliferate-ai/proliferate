import "@/lib/access/cloud/client";
import { useQuery } from "@tanstack/react-query";
import { getSlackBotConfig } from "@proliferate/cloud-sdk/client/slack";
import type { SlackBotConfigResponse } from "@/lib/access/cloud/client";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { slackBotConfigKey } from "@/hooks/access/cloud/slack/query-keys";

export function useSlackBotConfig(
  organizationId: string | null,
  enabled = true,
) {
  const { cloudActive } = useCloudAvailabilityState();

  return useQuery<SlackBotConfigResponse>({
    queryKey: slackBotConfigKey(organizationId),
    enabled: enabled && cloudActive && organizationId !== null,
    queryFn: () => getSlackBotConfig(organizationId!),
  });
}
