import type { Dispatch, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type {
  CloudCommandEnvelope,
  CloudCommandResponse,
  CloudSessionProjection,
  CloudTranscriptItem,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import {
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";

import type {
  SendPromptPayload,
  StartSessionPayload,
  UpdateSessionConfigPayload,
} from "../../../lib/access/cloud/pending-home-prompt-dispatch";
import type { PendingHomePrompt } from "../../../lib/access/cloud/pending-home-prompt-store";
import type {
  WebCloudPromptIntent,
} from "../../../stores/cloud/web-cloud-prompt-intent-store";
import type {
  WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-session-draft-store";
import { useWebCloudPlanDecisionActions } from "./use-web-cloud-plan-decision-actions";
import { useWebCloudPromptActions } from "./use-web-cloud-prompt-actions";
import { useWebCloudSessionConfigActions } from "./use-web-cloud-session-config-actions";
import { useWebCloudSessionDraftActions } from "./use-web-cloud-session-draft-actions";
import { useWebCloudWorkspaceActions } from "./use-web-cloud-workspace-actions";

type EnqueueCommand<TPayload> = (
  command: CloudCommandEnvelope<TPayload>,
) => Promise<CloudCommandResponse>;

export function useWebCloudChatActions(input: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail | null;
  session: CloudSessionProjection | null;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  isUnclaimed: boolean;
  canStartNewSession: boolean;
  workspaceStatus: string | null;
  workspaceHarnessAvailability: { message?: string | null };
  directPromptDispatching: boolean;
  setDirectPromptDispatching: Dispatch<SetStateAction<boolean>>;
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  setOptimisticPrompts: Dispatch<SetStateAction<WebCloudPromptIntent[]>>;
  setPendingHomePrompt: Dispatch<SetStateAction<PendingHomePrompt | null>>;
  setPendingSessionDraft: Dispatch<SetStateAction<WebCloudSessionDraft | null>>;
  pendingSessionDraft: WebCloudSessionDraft | null;
  routeSessionDraftId: string | null;
  setPendingConfigChanges: Dispatch<SetStateAction<Record<string, PendingConfigChange>>>;
  pendingConfigMutationIdRef: { current: number };
  setLaunchSelection: Dispatch<SetStateAction<CloudLaunchComposerSelection>>;
  agentCatalog: Parameters<typeof resolveCloudLaunchSelection>[0]["catalog"];
  workspaceLaunchableAgentKinds: readonly string[];
  resolvedLaunchSelection: CloudLaunchComposerSelection;
  sessionModelId: string | null;
  mountedRef: { current: boolean };
  setLatestCommandId: Dispatch<SetStateAction<string | null>>;
  enqueuePrompt: EnqueueCommand<SendPromptPayload>;
  enqueueStartSession: EnqueueCommand<StartSessionPayload>;
  enqueueConfig: EnqueueCommand<UpdateSessionConfigPayload>;
  enqueuePlanDecision: EnqueueCommand<{
    workspaceId: string;
    planId: string;
    decision: "approve" | "reject";
    expectedDecisionVersion: number;
  }>;
  workspaceRefetch: () => Promise<unknown> | unknown;
  transcriptRefetch: () => Promise<unknown> | unknown;
  sessionEventsRefetch: () => Promise<unknown> | unknown;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  claimWorkspace: {
    isPending: boolean;
    mutateAsync: (input: { workspaceId: string }) => Promise<unknown>;
  };
  navigate: NavigateFunction;
}) {
  const {
    client,
    workspace,
    session,
    draft,
    setDraft,
    isUnclaimed,
    canStartNewSession,
    workspaceStatus,
    workspaceHarnessAvailability,
    directPromptDispatching,
    setDirectPromptDispatching,
    setPendingHomePromptStatus,
    setOptimisticPrompts,
    setPendingHomePrompt,
    setPendingSessionDraft,
    pendingSessionDraft,
    routeSessionDraftId,
    setPendingConfigChanges,
    pendingConfigMutationIdRef,
    setLaunchSelection,
    agentCatalog,
    workspaceLaunchableAgentKinds,
    resolvedLaunchSelection,
    sessionModelId,
    mountedRef,
    setLatestCommandId,
    enqueuePrompt,
    enqueueStartSession,
    enqueueConfig,
    enqueuePlanDecision,
    workspaceRefetch,
    transcriptRefetch,
    sessionEventsRefetch,
    transcriptItems,
    transcriptRows,
    claimWorkspace,
    navigate,
  } = input;
  const {
    activePlanDecision,
    setActivePlanDecision,
    transcriptPlanActions,
  } = useWebCloudPlanDecisionActions({
    client,
    workspace,
    session,
    isUnclaimed,
    resolvedAgentKind: resolvedLaunchSelection.agentKind,
    sessionModelId,
    mountedRef,
    setLatestCommandId,
    setPendingHomePromptStatus,
    enqueuePlanDecision,
    transcriptRefetch,
    sessionEventsRefetch,
  });
  const { submitPrompt } = useWebCloudPromptActions({
    client,
    workspace,
    session,
    draft,
    setDraft,
    isUnclaimed,
    canStartNewSession,
    workspaceStatus,
    workspaceHarnessAvailability,
    directPromptDispatching,
    setDirectPromptDispatching,
    setPendingHomePromptStatus,
    setOptimisticPrompts,
    setPendingHomePrompt,
    setPendingSessionDraft,
    pendingSessionDraft,
    routeSessionDraftId,
    agentCatalog,
    workspaceLaunchableAgentKinds,
    resolvedLaunchSelection,
    sessionModelId,
    mountedRef,
    setLatestCommandId,
    enqueuePrompt,
    enqueueStartSession,
    enqueueConfig,
    workspaceRefetch,
    transcriptRefetch,
    sessionEventsRefetch,
    transcriptItems,
    transcriptRows,
    navigate,
  });
  const { submitSessionConfig } = useWebCloudSessionConfigActions({
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
  });
  const { openNewSessionDraft } = useWebCloudSessionDraftActions({
    workspace,
    canStartNewSession,
    workspaceHarnessAvailability,
    setPendingHomePromptStatus,
    setPendingSessionDraft,
    pendingSessionDraft,
    setPendingConfigChanges,
    setLaunchSelection,
    agentCatalog,
    workspaceLaunchableAgentKinds,
    resolvedLaunchSelection,
    navigate,
  });
  const {
    claimCurrentWorkspace,
    copyComposerFooterValue,
  } = useWebCloudWorkspaceActions({
    workspace,
    setPendingHomePromptStatus,
    workspaceRefetch,
    claimWorkspace,
  });

  return {
    activePlanDecision,
    setActivePlanDecision,
    submitPrompt,
    submitSessionConfig,
    transcriptPlanActions,
    claimCurrentWorkspace,
    copyComposerFooterValue,
    openNewSessionDraft,
  };
}
