import type { Dispatch, SetStateAction } from "react";
import type {
  CloudCommandEnvelope,
  CloudCommandResponse,
  CloudSessionProjection,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import type {
  CloudLaunchComposerSelection,
  PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import { pendingConfigChangeKey } from "@proliferate/product-domain/chats/cloud/composer-controls";
import { cloudCommandReadiness } from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import { prepareManagedWorkspaceForCloudCommands } from "../../../lib/access/cloud/managed-workspace-command-readiness";
import type { UpdateSessionConfigPayload } from "../../../lib/access/cloud/cloud-command-payloads";

type EnqueueCommand<TPayload> = (
  command: CloudCommandEnvelope<TPayload>,
) => Promise<CloudCommandResponse>;

export function useWebCloudSessionConfigActions(input: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail | null;
  session: CloudSessionProjection | null;
  isUnclaimed: boolean;
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  setPendingConfigChanges: Dispatch<SetStateAction<Record<string, PendingConfigChange>>>;
  pendingConfigMutationIdRef: { current: number };
  resolvedLaunchSelection: CloudLaunchComposerSelection;
  sessionModelId: string | null;
  mountedRef: { current: boolean };
  setLatestCommandId: Dispatch<SetStateAction<string | null>>;
  enqueueConfig: EnqueueCommand<UpdateSessionConfigPayload>;
}) {
  const {
    client,
    workspace,
    session,
    isUnclaimed,
    setPendingHomePromptStatus,
    setPendingConfigChanges,
    pendingConfigMutationIdRef,
    resolvedLaunchSelection,
    sessionModelId,
    mountedRef,
    setLatestCommandId,
    enqueueConfig,
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
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingHomePromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
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
      const commandWorkspace = await prepareManagedWorkspaceForCloudCommands({
        client,
        workspace,
        agentKind: session.sourceAgentKind ?? resolvedLaunchSelection.agentKind,
        modelId: sessionModelId,
        idempotencyKey: `web:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${mutationId}:target-config`,
        setLatestCommandId,
        onStatus: setPendingHomePromptStatus,
        shouldContinue: () => mountedRef.current,
      });
      const command = await enqueueConfig({
        idempotencyKey: `web:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${value}:${mutationId}`,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: commandWorkspace.id,
        sessionId: session.sessionId,
        kind: "update_session_config",
        source: "web",
        observedEventSeq: session.lastEventSeq ?? null,
        payload: { configId: rawConfigId, value },
      });
      if (!mountedRef.current) {
        return;
      }
      setLatestCommandId(command.commandId);
      setPendingConfigChanges((current) => {
        const existing = current[changeKey];
        if (!existing || existing.mutationId !== mutationId) {
          return current;
        }
        return {
          ...current,
          [changeKey]: { ...existing, commandId: command.commandId, status: "queued" },
        };
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
