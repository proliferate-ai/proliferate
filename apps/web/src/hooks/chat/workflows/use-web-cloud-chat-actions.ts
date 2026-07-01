import type { Dispatch, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type {
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

export function useWebCloudChatActions(input: {
  client: ProliferateCloudClient;
  productToken: string | null;
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
  mountedRef: { current: boolean };
  workspaceRefetch: () => Promise<unknown> | unknown;
  transcriptRefetch: () => Promise<unknown> | unknown;
  sessionEventsRefetch: () => Promise<unknown> | unknown;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  navigate: NavigateFunction;
}) {
  const {
    client,
    productToken,
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
    mountedRef,
    workspaceRefetch,
    transcriptRefetch,
    sessionEventsRefetch,
    transcriptItems,
    transcriptRows,
    navigate,
  } = input;
  const {
    activePlanDecision,
    setActivePlanDecision,
    transcriptPlanActions,
  } = useWebCloudPlanDecisionActions({
    client,
    productToken,
    workspace,
    session,
    isUnclaimed,
    mountedRef,
    setPendingHomePromptStatus,
    transcriptRefetch,
    sessionEventsRefetch,
  });
  const { submitPrompt } = useWebCloudPromptActions({
    client,
    productToken,
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
    mountedRef,
    workspaceRefetch,
    transcriptRefetch,
    sessionEventsRefetch,
    transcriptItems,
    transcriptRows,
    navigate,
  });
  const { submitSessionConfig } = useWebCloudSessionConfigActions({
    client,
    productToken,
    workspace,
    session,
    isUnclaimed,
    setPendingHomePromptStatus,
    setPendingConfigChanges,
    pendingConfigMutationIdRef,
    mountedRef,
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
  } = useWebCloudWorkspaceActions();

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
