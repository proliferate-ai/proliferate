import "@/lib/access/cloud/client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildSlackOAuthStartUrl,
  getSlackBotConfig,
} from "@proliferate/cloud-sdk/client/slack";
import type {
  SlackBotConfigResponse,
  SlackWorkspaceConnection,
} from "@/lib/access/cloud/client";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { slackBotConfigKey } from "@/hooks/access/cloud/slack/query-keys";

export function useSlackConnection(
  organizationId: string | null,
  enabled = true,
) {
  const { cloudActive } = useCloudAvailabilityState();
  const oauthStartUrl = useMemo(
    () => organizationId ? buildSlackOAuthStartUrl({ organizationId }) : null,
    [organizationId],
  );

  const query = useQuery<SlackBotConfigResponse, Error, SlackWorkspaceConnection | null>({
    queryKey: slackBotConfigKey(organizationId),
    enabled: enabled && cloudActive && organizationId !== null,
    queryFn: () => getSlackBotConfig(organizationId!),
    select: (response) => response.connection,
  });

  return {
    ...query,
    connection: query.data ?? null,
    oauthStartUrl,
  };
}
