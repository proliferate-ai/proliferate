import type { Dispatch, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type {
  CloudSessionProjection,
  CloudTranscriptItem,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import {
  buildLaunchSessionConfigUpdates,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import {
  latestCloudTranscriptSeq,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-domain/chats/cloud/transcript-view";
import type { Session } from "@anyharness/sdk";

import { routes } from "../../../config/routes";
import { isWorkspacePreparationStatus } from "../../../lib/domain/chat/cloud-chat-command-presentation";
import { removeRetryReplacedFailedPrompts } from "../../../lib/domain/chat/cloud-chat-prompt-projection";
import {
  clearPendingHomePrompt,
  savePendingHomePrompt,
  type PendingHomePrompt,
} from "../../../lib/access/cloud/pending-home-prompt-store";
import {
  type WebCloudPromptIntent,
} from "../../../stores/cloud/web-cloud-prompt-intent-store";
import {
  clearWebCloudSessionDraft,
  type WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-session-draft-store";
import {
  getWebCloudSandboxAnyHarnessClient,
  isWebCloudSandboxWorkspace,
} from "../../../lib/access/anyharness/cloud-sandbox-runtime";

export function useWebCloudPromptActions(input: {
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

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !workspace) {
      return;
    }
    if (isUnclaimed) {
      setPendingHomePromptStatus("Claim this shared workspace before sending prompts.");
      return;
    }
    if (!isWebCloudSandboxWorkspace(workspace)) {
      setPendingHomePromptStatus("Cloud workspace runtime is unavailable.");
      return;
    }
    if (!session) {
      await submitPromptToNewSession(text);
      return;
    }
    await submitPromptToExistingSession(text, session);
  }

  async function submitPromptToNewSession(text: string) {
    if (!workspace) {
      return;
    }
    if (!canStartNewSession) {
      setPendingHomePromptStatus(
        workspaceHarnessAvailability.message
          ?? "No cloud agent is ready to start a new session in this workspace.",
      );
      return;
    }
    if (workspaceStatus !== "ready") {
      setPendingHomePromptStatus("Workspace is provisioning; the prompt will send when ready.");
      return;
    }
    if (directPromptDispatching) {
      return;
    }
    const promptId = `web-chat:${workspace.id}:${Date.now().toString(36)}`;
    const optimisticPrompt: WebCloudPromptIntent = {
      id: promptId,
      workspaceId: workspace.id,
      sessionId: null,
      text,
      baseTranscriptSeq: 0,
      status: "sending",
      createdAt: Date.now(),
    };
    setOptimisticPrompts((current) => [
      ...removeRetryReplacedFailedPrompts(current, optimisticPrompt),
      optimisticPrompt,
    ]);
    setDraft("");
    setDirectPromptDispatching(true);
    setPendingHomePromptStatus("Starting a session for this prompt.");
    const promptSelection = resolveCloudLaunchSelection({
      catalog: agentCatalog,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: pendingSessionDraft?.selection ?? resolvedLaunchSelection,
    });
    const promptConfigUpdates = pendingSessionDraft?.sessionConfigUpdates
      ?? buildLaunchSessionConfigUpdates({
        catalog: agentCatalog,
        launchableAgentKinds: workspaceLaunchableAgentKinds,
        selection: promptSelection,
      });
    const pendingPrompt: PendingHomePrompt = {
      id: promptId,
      text,
      agentKind: promptSelection.agentKind,
      modelId: promptSelection.modelId,
      modeId: promptSelection.modeId,
      sessionConfigUpdates: promptConfigUpdates,
      createdAt: Date.now(),
    };
    savePendingHomePrompt(workspace.id, pendingPrompt);
    try {
      const result = await dispatchCloudSandboxPendingHomePrompt({
        client,
        productToken,
        workspace,
        pendingPrompt,
        fallbackAgentKind: promptSelection.agentKind,
        onStatus: setPendingHomePromptStatus,
        shouldContinue: () => mountedRef.current,
      });
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id
            ? {
              ...prompt,
              sessionId: result.sessionId,
              status: "queued",
              commandId: result.sendCommandId ?? prompt.commandId,
            }
            : prompt
        )
      );
      clearPendingHomePrompt(workspace.id);
      clearWebCloudSessionDraft(workspace.id, pendingSessionDraft?.id ?? routeSessionDraftId);
      setPendingSessionDraft(null);
      setPendingHomePrompt(null);
      setPendingHomePromptStatus(null);
      await workspaceRefetch();
      navigate(routes.chat(workspace.id, result.sessionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Prompt could not be sent.";
      const isPreparing = isWorkspacePreparationStatus(message);
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id
            ? { ...prompt, status: isPreparing ? "queued" : "failed" }
            : prompt
        )
      );
      setDraft((current) => current.trim() ? current : text);
      const prompt: PendingHomePrompt = {
        ...pendingPrompt,
        status: isPreparing ? "pending" : "failed",
        errorMessage: message,
      };
      savePendingHomePrompt(workspace.id, prompt);
      setPendingHomePrompt(prompt);
      setPendingHomePromptStatus(message);
    } finally {
      setDirectPromptDispatching(false);
    }
  }

  async function submitPromptToExistingSession(text: string, activeSession: CloudSessionProjection) {
    if (!workspace) {
      return;
    }
    const optimisticPrompt: WebCloudPromptIntent = {
      id: `web:${workspace.id}:${activeSession.sessionId}:${Date.now()}`,
      workspaceId: workspace.id,
      sessionId: activeSession.sessionId,
      text,
      baseTranscriptSeq: latestCloudTranscriptSeq(transcriptItems, transcriptRows),
      status: "sending",
      createdAt: Date.now(),
    };
    setOptimisticPrompts((current) => [
      ...removeRetryReplacedFailedPrompts(current, optimisticPrompt),
      optimisticPrompt,
    ]);
    setDraft("");
    setPendingHomePromptStatus(null);
    try {
      if (isWebCloudSandboxWorkspace(workspace)) {
        const { anyharness } = await getWebCloudSandboxAnyHarnessClient({
          workspace,
          productToken,
          client,
        });
        await anyharness.sessions.prompt(activeSession.sessionId, {
          blocks: [{ type: "text", text }],
          promptId: optimisticPrompt.id,
        });
      } else {
        throw new Error("Cloud workspace runtime is unavailable.");
      }
      if (!mountedRef.current) {
        return;
      }
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "queued" } : prompt
        )
      );
      setPendingHomePromptStatus(null);
      void transcriptRefetch();
      void sessionEventsRefetch();
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "failed" } : prompt
        )
      );
      setDraft((current) => current.trim() ? current : text);
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : "Prompt could not be sent.",
      );
    }
  }

  return { submitPrompt };
}

async function dispatchCloudSandboxPendingHomePrompt(args: {
  client: ProliferateCloudClient;
  productToken: string | null;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: PendingHomePrompt;
  fallbackAgentKind: string;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<{ sessionId: string; sendCommandId?: string }> {
  args.onStatus("Preparing cloud sandbox runtime.");
  const { connection, anyharness } = await getWebCloudSandboxAnyHarnessClient({
    workspace: args.workspace,
    productToken: args.productToken,
    client: args.client,
  });
  assertManagedWebActionCurrent(args.shouldContinue);
  args.onStatus("Starting session.");
  const session = await anyharness.sessions.create({
    workspaceId: connection.anyharnessWorkspaceId,
    agentKind: args.pendingPrompt.agentKind ?? args.fallbackAgentKind,
    ...(args.pendingPrompt.modelId ? { modelId: args.pendingPrompt.modelId } : {}),
    ...(args.pendingPrompt.modeId ? { modeId: args.pendingPrompt.modeId } : {}),
    subagentsEnabled: false,
    origin: { kind: "system", entrypoint: "cloud" },
  });
  await applyCloudSandboxSessionConfigUpdates(anyharness, session, args.pendingPrompt);
  assertManagedWebActionCurrent(args.shouldContinue);
  args.onStatus("Sending prompt.");
  await anyharness.sessions.prompt(session.id, {
    blocks: [{ type: "text", text: args.pendingPrompt.text }],
    promptId: args.pendingPrompt.id,
  });
  args.onStatus("Queued prompt; waiting for transcript.");
  return { sessionId: session.id };
}

async function applyCloudSandboxSessionConfigUpdates(
  anyharness: Awaited<ReturnType<typeof getWebCloudSandboxAnyHarnessClient>>["anyharness"],
  session: Session,
  pendingPrompt: PendingHomePrompt,
): Promise<void> {
  for (const update of pendingPrompt.sessionConfigUpdates ?? []) {
    await anyharness.sessions.setConfigOption(session.id, update);
  }
}

function assertManagedWebActionCurrent(shouldContinue: () => boolean): void {
  if (!shouldContinue()) {
    throw new Error("Action was cancelled.");
  }
}
