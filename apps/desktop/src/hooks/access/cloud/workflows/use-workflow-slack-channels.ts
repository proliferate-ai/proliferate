import { useQuery } from "@tanstack/react-query";
// Side-effect: registers the auth-aware desktop cloud client factory.
import "@/lib/access/cloud/client";
import { listSlackChannels } from "@/lib/access/cloud/workflows";
import type { SlackChannelsResponse } from "./types";
import { workflowSlackChannelsKey } from "./query-keys";

/**
 * The connected Slack account's channels (spec 8.2, PR A): backs the notify
 * step's Slack channel picker. `connected: false` means no ready Slack
 * account — the editor shows a "Connect Slack" caption instead of a picker.
 */
export function useWorkflowSlackChannels(enabled = true) {
  return useQuery<SlackChannelsResponse>({
    queryKey: workflowSlackChannelsKey(),
    queryFn: () => listSlackChannels(),
    enabled,
  });
}
