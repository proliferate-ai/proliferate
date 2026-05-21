import "@/lib/access/cloud/client";
import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  disconnectSlackWorkspace,
  updateSlackBotConfig,
  validateSlackConnection,
} from "@proliferate/cloud-sdk/client/slack";
import type {
  SlackBotConfigResponse,
  SlackConnectionValidationResponse,
  SlackDisconnectResponse,
  UpdateSlackBotConfigRequest,
} from "@/lib/access/cloud/client";
import {
  slackBotConfigKey,
  slackChannelsKey,
  slackRepoRoutingProfilesKey,
  slackRootKey,
} from "@/hooks/access/cloud/slack/query-keys";

export function useSlackBotConfigMutations(organizationId: string | null) {
  const queryClient = useQueryClient();

  const invalidateSlack = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: slackRootKey() });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: slackBotConfigKey(organizationId) }),
      queryClient.invalidateQueries({ queryKey: slackChannelsKey(organizationId) }),
      queryClient.invalidateQueries({
        queryKey: slackRepoRoutingProfilesKey(organizationId),
      }),
    ]);
  }, [organizationId, queryClient]);

  const updateMutation = useMutation<
    SlackBotConfigResponse,
    Error,
    UpdateSlackBotConfigRequest
  >({
    mutationFn: (body) => updateSlackBotConfig(organizationId!, body),
    onSuccess: invalidateSlack,
  });

  const validateMutation = useMutation<SlackConnectionValidationResponse, Error, void>({
    mutationFn: () => validateSlackConnection(organizationId!),
    onSuccess: invalidateSlack,
  });

  const disconnectMutation = useMutation<SlackDisconnectResponse, Error, void>({
    mutationFn: () => disconnectSlackWorkspace(organizationId!),
    onSuccess: invalidateSlack,
  });

  return {
    updateMutation,
    validateMutation,
    disconnectMutation,
    invalidateSlack,
  };
}
