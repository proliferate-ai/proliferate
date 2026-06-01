import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  CloudPendingInteraction,
  CloudSessionProjection,
  CloudTranscriptItem,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";
import {
  useClaimCloudWorkspace,
  useCloudClient,
  useCommandStatus,
  useEnqueueCloudCommand,
  invalidateCloudWorkspaceLists,
} from "@proliferate/cloud-sdk-react";
import {
  buildLaunchSessionConfigUpdates,
  pendingConfigChangeKey,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import { latestCloudTranscriptSeq } from "@proliferate/product-domain/chats/cloud/transcript-view";
import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";
import { cloudCommandReadiness } from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import type {
  MobilePendingPrompt,
} from "../../../navigation/navigation-model";
import {
  clearPendingMobilePrompt,
  savePendingMobilePrompt,
} from "../../../lib/access/cloud/pending-mobile-prompt-store";
import {
  ensureMobileWorkspaceReadyForCloudCommands,
  type SendPromptPayload,
  type StartSessionPayload,
} from "../../../lib/access/cloud/pending-mobile-prompt-dispatch";
import type { OptimisticPrompt } from "../../../lib/domain/chat/mobile-chat-transcript";
import type { PermissionInteractionOption } from "../../../lib/domain/chat/mobile-chat-permissions";
import { resolveAgentKind } from "../../../lib/domain/chat/mobile-chat-presentation";
import { useMobileChatComposerControls } from "../facade/use-mobile-chat-composer-controls";

type UpdateSessionConfigPayload = {
  configId: string;
  value: string;
};

type ResolveInteractionPayload = {
  requestId: string;
  resolution: {
    outcome: "selected";
    optionId: string;
  };
};

export function useMobileChatActions({
  ownerUserId,
  workspace,
  workspaceStatus,
  session,
  targetId,
  draft,
  pendingPrompt,
  pendingPromptFailed,
  hasActiveOptimisticPrompt,
  launchSelection,
  runtimeLabel,
  transcriptItems,
  transcriptRows,
  isUnclaimed,
  pendingPromptCommandId,
  pendingConfigChanges,
  setDraft,
  setLaunchSelection,
  setPendingPrompt,
  setPendingPromptStatus,
  setPendingPromptFailed,
  setOptimisticPrompts,
  setPendingConfigChanges,
  setSelectedSessionId,
  setNewSessionMode,
  setClaimedLocally,
  setPermissionResolveError,
  setResolvingPermissionKey,
  setToolDetailRow,
  onSessionSelected,
  closeWorkspaceActionSheet,
  workspaceRefetch,
  transcriptRefetch,
  sessionEventsRefetch,
}: {
  ownerUserId: string | null;
  workspace: CloudWorkspaceDetail | null;
  workspaceStatus: string;
  session: CloudSessionProjection | null;
  targetId: string | null;
  draft: string;
  pendingPrompt: MobilePendingPrompt | null;
  pendingPromptFailed: boolean;
  hasActiveOptimisticPrompt: boolean;
  launchSelection: CloudLaunchComposerSelection;
  runtimeLabel: string;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  isUnclaimed: boolean;
  pendingPromptCommandId: string | null;
  pendingConfigChanges: Record<string, PendingConfigChange>;
  setDraft: Dispatch<SetStateAction<string>>;
  setLaunchSelection: Dispatch<SetStateAction<CloudLaunchComposerSelection>>;
  setPendingPrompt: Dispatch<SetStateAction<MobilePendingPrompt | null>>;
  setPendingPromptStatus: Dispatch<SetStateAction<string | null>>;
  setPendingPromptFailed: Dispatch<SetStateAction<boolean>>;
  setOptimisticPrompts: Dispatch<SetStateAction<OptimisticPrompt[]>>;
  setPendingConfigChanges: Dispatch<SetStateAction<Record<string, PendingConfigChange>>>;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setNewSessionMode: Dispatch<SetStateAction<boolean>>;
  setClaimedLocally: Dispatch<SetStateAction<boolean>>;
  setPermissionResolveError: Dispatch<SetStateAction<string | null>>;
  setResolvingPermissionKey: Dispatch<SetStateAction<string | null>>;
  setToolDetailRow: Dispatch<SetStateAction<CloudChatTranscriptRowView | null>>;
  onSessionSelected?: (sessionId: string) => void;
  closeWorkspaceActionSheet: () => void;
  workspaceRefetch: () => void | Promise<unknown>;
  transcriptRefetch: () => void | Promise<unknown>;
  sessionEventsRefetch: () => void | Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const client = useCloudClient();
  const enqueuePrompt = useEnqueueCloudCommand<SendPromptPayload>();
  const enqueueStartSession = useEnqueueCloudCommand<StartSessionPayload>();
  const enqueueConfig = useEnqueueCloudCommand<UpdateSessionConfigPayload>();
  const enqueueInteraction = useEnqueueCloudCommand<ResolveInteractionPayload>();
  const claimWorkspace = useClaimCloudWorkspace();
  const [latestCommandId, setLatestCommandId] = useState<string | null>(null);
  const [latestConfigCommandId, setLatestConfigCommandId] = useState<string | null>(null);
  const [directPromptDispatching, setLocalDirectPromptDispatching] = useState(false);
  const directPromptDispatchingRef = useRef(false);
  const sessionPromptDispatchingRef = useRef(false);
  const pendingDispatchRunRef = useRef<{ key: string; active: boolean } | null>(null);
  const pendingConfigMutationIdRef = useRef(0);
  const commandStatus = useCommandStatus(pendingPromptCommandId ?? latestCommandId);
  const configCommandStatus = useCommandStatus(latestConfigCommandId);
  const {
    agentCatalog,
    workspaceHarnessAvailability,
    workspaceLaunchableAgentKinds,
    canStartNewSession,
    liveConfig,
    sessionModelId,
    resolvedLaunchSelection,
    composerControls,
    composerControlSummary,
  } = useMobileChatComposerControls({
    workspace,
    session,
    pendingConfigChanges,
    launchSelection,
    runtimeLabel,
    setLaunchSelection,
    onSubmitSessionConfig: (rawConfigId, value) => {
      void submitSessionConfig(rawConfigId, value);
    },
    onStartNewSession: startNewSession,
  });

  function setDirectDispatching(value: boolean) {
    setLocalDirectPromptDispatching(value);
  }

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !workspace) {
      return;
    }
    if (isUnclaimed) {
      setPendingPromptStatus("Claim this workspace before sending prompts from mobile.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingPromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
      return;
    }
    if (!session) {
      if (!ownerUserId) {
        setPendingPromptStatus("Account is still loading. Try again in a moment.");
        return;
      }
      if (directPromptDispatchingRef.current || (pendingPrompt && !pendingPromptFailed)) {
        return;
      }
      if (!canStartNewSession) {
        setPendingPromptStatus(
          workspaceHarnessAvailability.message ?? "No cloud agent is ready for a new session.",
        );
        return;
      }
      const promptSelection = resolveCloudLaunchSelection({
        catalog: agentCatalog.data,
        launchableAgentKinds: workspaceLaunchableAgentKinds,
        selection: resolvedLaunchSelection,
      });
      directPromptDispatchingRef.current = true;
      const prompt: MobilePendingPrompt = {
        id: `mobile-chat:${workspace.id}:${Date.now().toString(36)}`,
        text,
        agentKind: promptSelection.agentKind,
        modelId: promptSelection.modelId,
        modeId: promptSelection.modeId,
        sessionConfigUpdates: buildLaunchSessionConfigUpdates({
          catalog: agentCatalog.data,
          launchableAgentKinds: workspaceLaunchableAgentKinds,
          selection: promptSelection,
        }),
        createdAt: Date.now(),
      };
      setDraft("");
      setPendingPrompt(prompt);
      setPendingPromptStatus("Starting a session for this prompt.");
      setPendingPromptFailed(false);
      setDirectDispatching(true);
      try {
        await savePendingMobilePrompt(workspace.id, ownerUserId, prompt);
      } catch (error) {
        setPendingPromptStatus(
          error instanceof Error
            ? `Prompt will send while this chat stays open. Storage failed: ${error.message}`
            : "Prompt will send while this chat stays open, but could not be saved.",
        );
      } finally {
        directPromptDispatchingRef.current = false;
        setDirectDispatching(false);
      }
      return;
    }

    if (sessionPromptDispatchingRef.current || hasActiveOptimisticPrompt) {
      return;
    }
    sessionPromptDispatchingRef.current = true;
    const optimisticPrompt: OptimisticPrompt = {
      id: `mobile:${workspace.id}:${session.sessionId}:${Date.now()}`,
      sessionId: session.sessionId,
      text,
      baseTranscriptSeq: latestCloudTranscriptSeq(transcriptItems, transcriptRows),
      status: "sending",
    };
    setOptimisticPrompts((current) => [...current, optimisticPrompt]);
    setDraft("");
    setPendingPromptStatus(null);
    try {
      await ensureMobileWorkspaceReadyForCloudCommands({
        client,
        workspace,
        agentKind: session.sourceAgentKind ?? resolveAgentKind(workspace),
        modelId: sessionModelId,
        idempotencyKey: `${optimisticPrompt.id}:target-config`,
        setLatestCommandId,
        onStatus: setPendingPromptStatus,
        shouldContinue: () => sessionPromptDispatchingRef.current,
      });
      const command = await enqueuePrompt.mutateAsync({
        idempotencyKey: optimisticPrompt.id,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: session.sessionId,
        kind: "send_prompt",
        source: "mobile",
        payload: { text, promptId: optimisticPrompt.id },
      });
      setLatestCommandId(command.commandId);
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id
            ? { ...prompt, commandId: command.commandId, status: "queued" }
            : prompt
        )
      );
      void transcriptRefetch();
      void sessionEventsRefetch();
    } catch (error) {
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "failed" } : prompt
        )
      );
      setPendingPromptStatus(error instanceof Error ? error.message : "Prompt could not be sent.");
    } finally {
      sessionPromptDispatchingRef.current = false;
    }
  }

  async function submitSessionConfig(rawConfigId: string, value: string) {
    if (!workspace || !session) {
      return;
    }
    if (isUnclaimed) {
      setPendingPromptStatus("Claim this workspace before changing session settings.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingPromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
      return;
    }
    const mutationId = pendingConfigMutationIdRef.current + 1;
    pendingConfigMutationIdRef.current = mutationId;
    const changeKey = pendingConfigChangeKey(session.sessionId, rawConfigId);
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
      await ensureMobileWorkspaceReadyForCloudCommands({
        client,
        workspace,
        agentKind: session.sourceAgentKind ?? resolveAgentKind(workspace),
        modelId: sessionModelId,
        idempotencyKey: `mobile:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${mutationId}:target-config`,
        setLatestCommandId,
        onStatus: setPendingPromptStatus,
        shouldContinue: () => true,
      });
      const command = await enqueueConfig.mutateAsync({
        idempotencyKey: `mobile:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${value}:${mutationId}`,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: session.sessionId,
        kind: "update_session_config",
        source: "mobile",
        observedEventSeq: session.lastEventSeq ?? null,
        payload: { configId: rawConfigId, value },
      });
      setLatestCommandId(command.commandId);
      setLatestConfigCommandId(command.commandId);
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
      setPendingConfigChanges((current) => {
        const { [changeKey]: _removed, ...rest } = current;
        return rest;
      });
      setPendingPromptStatus(
        error instanceof Error ? error.message : "Session configuration could not be updated.",
      );
    }
  }

  async function resolvePermissionInteraction(
    interaction: CloudPendingInteraction,
    option: PermissionInteractionOption,
  ) {
    if (!workspace || !session || !targetId) {
      setPermissionResolveError("Session is still loading. Try again in a moment.");
      return;
    }
    if (isUnclaimed) {
      setPermissionResolveError("Claim this workspace before approving commands from mobile.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPermissionResolveError(
        readiness.message ?? "This workspace cannot accept cloud commands right now.",
      );
      return;
    }
    const key = `${interaction.requestId}:${option.optionId}`;
    setResolvingPermissionKey(key);
    setPermissionResolveError(null);
    try {
      const command = await enqueueInteraction.mutateAsync({
        idempotencyKey: `mobile:${workspace.id}:${session.sessionId}:interaction:${interaction.requestId}:${option.optionId}:${Date.now()}`,
        targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: session.sessionId,
        kind: "resolve_interaction",
        source: "mobile",
        observedEventSeq: session.lastEventSeq ?? null,
        payload: {
          requestId: interaction.requestId,
          resolution: {
            outcome: "selected",
            optionId: option.optionId,
          },
        },
      });
      setLatestCommandId(command.commandId);
      setPendingPromptStatus(null);
      setToolDetailRow(null);
      void transcriptRefetch();
      void sessionEventsRefetch();
      void workspaceRefetch();
    } catch (error) {
      setPermissionResolveError(
        error instanceof Error ? error.message : "Permission response could not be sent.",
      );
    } finally {
      setResolvingPermissionKey((current) => current === key ? null : current);
    }
  }

  async function claimChat(): Promise<boolean> {
    if (!workspace) {
      return false;
    }
    try {
      await claimWorkspace.mutateAsync({ workspaceId: workspace.id });
      setClaimedLocally(true);
      setPendingPromptStatus(null);
      void workspaceRefetch();
      invalidateCloudWorkspaceLists(queryClient);
      return true;
    } catch (error) {
      setPendingPromptStatus(error instanceof Error ? error.message : "Workspace could not be claimed.");
      return false;
    }
  }

  function startNewSession(selection?: CloudLaunchComposerSelection) {
    if (pendingDispatchRunRef.current) {
      pendingDispatchRunRef.current.active = false;
      pendingDispatchRunRef.current = null;
    }
    if (selection) {
      setLaunchSelection(selection);
    }
    if (pendingPrompt) {
      setPendingPrompt(null);
      if (ownerUserId && workspace) {
        void clearPendingMobilePrompt(workspace.id, ownerUserId);
      }
    }
    setSelectedSessionId(null);
    setNewSessionMode(true);
    setDraft("");
    setPendingPromptStatus(null);
    setPendingPromptFailed(false);
    closeWorkspaceActionSheet();
    return selection;
  }

  function selectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    setNewSessionMode(false);
    setDraft("");
    setPendingPromptStatus(null);
    setPendingPromptFailed(false);
    closeWorkspaceActionSheet();
    onSessionSelected?.(sessionId);
  }

  return {
    client,
    queryClient,
    commandStatus,
    configCommandStatus,
    pendingDispatchRunRef: pendingDispatchRunRef as MutableRefObject<{ key: string; active: boolean } | null>,
    enqueueStartSession,
    enqueueConfig,
    enqueuePrompt,
    setLatestCommandId,
    liveConfig,
    composerControls,
    composerControlSummary,
    canStartNewSession,
    workspaceHarnessAvailability,
    claimPending: claimWorkspace.isPending,
    promptSubmitting:
      enqueuePrompt.isPending
      || directPromptDispatching
      || (Boolean(pendingPrompt) && !pendingPromptFailed)
      || hasActiveOptimisticPrompt,
    submitPrompt,
    submitSessionConfig,
    resolvePermissionInteraction,
    claimChat,
    startNewSession,
    selectSession,
    setLatestConfigCommandId,
  };
}
