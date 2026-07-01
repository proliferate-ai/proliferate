import type { Dispatch, SetStateAction } from "react";
import type {
  CloudSessionProjection,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import type {
  PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import { pendingConfigChangeKey } from "@proliferate/product-domain/chats/cloud/composer-controls";

import {
  getWebCloudSandboxAnyHarnessClient,
  isWebCloudSandboxWorkspace,
} from "../../../lib/access/anyharness/cloud-sandbox-runtime";

export function useWebCloudSessionConfigActions(input: {
  client: ProliferateCloudClient;
  productToken: string | null;
  workspace: CloudWorkspaceDetail | null;
  session: CloudSessionProjection | null;
  isUnclaimed: boolean;
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  setPendingConfigChanges: Dispatch<SetStateAction<Record<string, PendingConfigChange>>>;
  pendingConfigMutationIdRef: { current: number };
  mountedRef: { current: boolean };
}) {
  const {
    client,
    productToken,
    workspace,
    session,
    isUnclaimed,
    setPendingHomePromptStatus,
    setPendingConfigChanges,
    pendingConfigMutationIdRef,
    mountedRef,
  } = input;

  async function submitSessionConfig(rawConfigId: string, value: string) {
    if (!workspace || !session) {
      return;
    }
    const mutationId = pendingConfigMutationIdRef.current + 1;
    pendingConfigMutationIdRef.current = mutationId;
    const changeKey = pendingConfigChangeKey(session.sessionId, rawConfigId);
    if (isUnclaimed) {
      setPendingHomePromptStatus("Claim this shared workspace before changing session settings.");
      return;
    }
    if (!isWebCloudSandboxWorkspace(workspace)) {
      setPendingHomePromptStatus("Cloud workspace runtime is unavailable.");
      return;
    }
    setPendingConfigChanges((current) => ({
      ...current,
      [changeKey]: {
        sessionId: session.sessionId,
        rawConfigId,
        value,
        status: "sending",
        mutationId,
      },
    }));
    try {
      const { anyharness } = await getWebCloudSandboxAnyHarnessClient({
        workspace,
        productToken,
        client,
      });
      await anyharness.sessions.setConfigOption(session.sessionId, {
        configId: rawConfigId,
        value,
      });
      if (!mountedRef.current) {
        return;
      }
      setPendingConfigChanges((current) => {
        const existing = current[changeKey];
        if (!existing || existing.mutationId !== mutationId) {
          return current;
        }
        const { [changeKey]: _removed, ...rest } = current;
        return rest;
      });
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setPendingConfigChanges((current) => {
        const existing = current[changeKey];
        if (!existing || existing.mutationId !== mutationId) {
          return current;
        }
        const { [changeKey]: _removed, ...rest } = current;
        return rest;
      });
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : "Session configuration could not be updated.",
      );
    }
  }

  return { submitSessionConfig };
}
