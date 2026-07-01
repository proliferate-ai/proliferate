import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import { createPromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import { resolveSessionViewState } from "@proliferate/product-domain/sessions/activity";
import {
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import type { CloudWorkspaceDetail } from "@proliferate/cloud-sdk";
import type { CloudChatSurfaceProps } from "@proliferate/product-ui/chat/CloudChatSurface";
import {
  useAgentLaunchOptionsQuery,
  useAnyHarnessWorkspaceContext,
  useApprovePlanMutation,
  useCreateSessionMutation,
  usePromptSessionMutation,
  useRejectPlanMutation,
  useSessionLiveConfigQuery,
  useSetSessionConfigOptionMutation,
  useWorkspaceSessionsQuery,
} from "@anyharness/sdk-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  buildAnyHarnessLaunchComposerControls,
  buildAnyHarnessSessionComposerControls,
  resolveAnyHarnessLaunchSelection,
} from "../../../lib/domain/chat/anyharness-launch-options";
import { routes } from "../../../config/routes";
import {
  clearPendingHomePrompt,
  loadPendingHomePrompt,
  savePendingHomePrompt,
} from "../../../lib/access/cloud/pending-home-prompt-store";
import { useWebAnyHarnessSessionTranscript } from "../cache/use-web-anyharness-session-transcript";
import { buildWebManagedSandboxChatSurfaceProps } from "./build-web-managed-sandbox-chat-surface-props";

export type WebManagedSandboxChatScreenState =
  | { kind: "missing"; title: string }
  | { kind: "workspace-loading" }
  | { kind: "ready"; surface: CloudChatSurfaceProps };

export function useWebManagedSandboxChatScreen(input: {
  workspace: CloudWorkspaceDetail;
}): WebManagedSandboxChatScreenState {
  const { workspace } = input;
  const { chatId } = useParams();
  const navigate = useNavigate();
  const workspaceContext = useAnyHarnessWorkspaceContext();
  const [draft, setDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PromptOutboxEntry | null>(null);
  const [pendingHomePrompt, setPendingHomePrompt] = useState(() =>
    loadPendingHomePrompt(workspace.id)
  );
  const pendingHomePromptDispatchingRef = useRef(false);
  const [launchSelection, setLaunchSelection] = useState<CloudLaunchComposerSelection>({
    agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: DEFAULT_DIRECT_PROMPT_MODEL_ID,
    modeId: null,
    controlValues: {},
  });

  const sessionsQuery = useWorkspaceSessionsQuery({ workspaceId: workspace.id });
  const sessions = useMemo(
    () => [...(sessionsQuery.data ?? [])].sort((left, right) =>
      Date.parse(right.updatedAt ?? right.createdAt) - Date.parse(left.updatedAt ?? left.createdAt)
    ),
    [sessionsQuery.data],
  );
  const session = chatId
    ? sessions.find((candidate) => candidate.id === chatId) ?? null
    : null;
  const activeSessionId = session?.id ?? null;
  const liveConfigQuery = useSessionLiveConfigQuery(activeSessionId, {
    workspaceId: workspace.id,
    enabled: Boolean(activeSessionId),
  });
  const transcript = useWebAnyHarnessSessionTranscript({
    workspaceId: workspace.id,
    sessionId: activeSessionId,
    enabled: Boolean(activeSessionId),
  });
  const launchOptions = useAgentLaunchOptionsQuery({
    enabled: !session,
  });
  const createSession = useCreateSessionMutation({ workspaceId: workspace.id });
  const promptSession = usePromptSessionMutation({ workspaceId: workspace.id });
  const setConfigOption = useSetSessionConfigOptionMutation({ workspaceId: workspace.id });
  const approvePlan = useApprovePlanMutation({ workspaceId: workspace.id });
  const rejectPlan = useRejectPlanMutation({ workspaceId: workspace.id });

  const resolvedLaunchSelection = useMemo(
    () => resolveAnyHarnessLaunchSelection({
      launchOptions: launchOptions.data,
      selection: launchSelection,
    }),
    [launchOptions.data, launchSelection],
  );
  const liveConfig = liveConfigQuery.data?.liveConfig ?? session?.liveConfig ?? null;
  const sessionViewState = useMemo(
    () => resolveSessionViewState(session
      ? {
        status: session.status,
        executionSummary: session.executionSummary,
        streamConnectionState: transcript.streamConnectionState,
        hasPromptActivity: Boolean(
          session.lastPromptAt
            || transcript.transcript?.turnOrder.length
            || transcript.transcript?.pendingPrompts.length
            || pendingPrompt,
        ),
        transcript: {
          isStreaming: transcript.transcript?.isStreaming ?? false,
          pendingInteractions: transcript.transcript?.pendingInteractions ?? [],
        },
      }
      : null),
    [
      pendingPrompt,
      session,
      transcript.streamConnectionState,
      transcript.transcript,
    ],
  );
  const submitSessionConfig = useCallback(async (configId: string, value: string) => {
    if (!session) {
      return;
    }
    setActionError(null);
    try {
      await setConfigOption.mutateAsync({
        sessionId: session.id,
        request: { configId, value },
      });
      await Promise.all([
        liveConfigQuery.refetch(),
        transcript.refetch(),
      ]);
    } catch (error) {
      setActionError(errorMessage(error, "Session setting could not be updated."));
    }
  }, [liveConfigQuery, session, setConfigOption, transcript]);

  const transcriptState = useMemo(
    () => session && transcript.transcript
      ? {
        activeSessionId: session.id,
        selectedWorkspaceId: workspace.id,
        transcript: transcript.transcript,
        sessionViewState,
        outboxEntries: pendingPrompt ? [pendingPrompt] : [],
      }
      : null,
    [pendingPrompt, session, sessionViewState, transcript.transcript, workspace.id],
  );
  const composerControls = useMemo(
    () => session
      ? buildAnyHarnessSessionComposerControls({
        session,
        liveConfig,
        onSelect: (configId, value) => {
          void submitSessionConfig(configId, value);
        },
      })
      : buildAnyHarnessLaunchComposerControls({
        launchOptions: launchOptions.data,
        selection: resolvedLaunchSelection,
        onSelect: setLaunchSelection,
      }),
    [launchOptions.data, liveConfig, resolvedLaunchSelection, session, submitSessionConfig],
  );

  const submitPrompt = useCallback(async () => {
    const text = draft.trim();
    if (!text || promptSession.isPending || createSession.isPending) {
      return;
    }

    setActionError(null);
    setDraft("");

    let targetSessionId = session?.id ?? null;
    const clientPromptId = createClientPromptId();
    const outbox = {
      ...createPromptOutboxEntry({
        clientPromptId,
        clientSessionId: targetSessionId ?? `web-pending:${clientPromptId}`,
        materializedSessionId: targetSessionId,
        workspaceId: workspace.id,
        text,
        blocks: [{ type: "text", text }],
      }),
      status: "dispatching" as const,
      deliveryState: "dispatching" as const,
      dispatchedAt: new Date().toISOString(),
    };
    setPendingPrompt(outbox);

    try {
      if (!targetSessionId) {
        const connection = await workspaceContext.resolveConnection(workspace.id);
        const created = await createSession.mutateAsync({
          workspaceId: workspace.id,
          request: {
            workspaceId: connection.anyharnessWorkspaceId,
            agentKind: resolvedLaunchSelection.agentKind,
            modelId: resolvedLaunchSelection.modelId,
            modeId: resolvedLaunchSelection.modeId,
          },
        });
        targetSessionId = created.id;
        navigate(routes.chat(workspace.id, created.id), { replace: true });
      }

      await promptSession.mutateAsync({
        sessionId: targetSessionId,
        request: {
          blocks: [{ type: "text", text }],
        },
      });
      await Promise.all([
        sessionsQuery.refetch(),
        transcript.refetch(),
      ]);
      window.setTimeout(() => setPendingPrompt(null), 800);
    } catch (error) {
      setDraft(text);
      setPendingPrompt(null);
      setActionError(errorMessage(error, "Prompt could not be sent."));
    }
  }, [
    createSession,
    draft,
    navigate,
    promptSession,
    resolvedLaunchSelection.agentKind,
    resolvedLaunchSelection.modeId,
    resolvedLaunchSelection.modelId,
    session?.id,
    sessionsQuery,
    transcript,
    workspace.id,
    workspaceContext,
  ]);

  useEffect(() => {
    if (
      !pendingHomePrompt
      || pendingHomePrompt.status === "failed"
      || pendingHomePromptDispatchingRef.current
      || sessionsQuery.isLoading
      || sessionsQuery.error
      || chatId
    ) {
      return;
    }

    pendingHomePromptDispatchingRef.current = true;
    setActionError(null);
    const text = pendingHomePrompt.text.trim();
    if (!text) {
      clearPendingHomePrompt(workspace.id);
      setPendingHomePrompt(null);
      pendingHomePromptDispatchingRef.current = false;
      return;
    }
    const selection = {
      agentKind: pendingHomePrompt.agentKind || resolvedLaunchSelection.agentKind,
      modelId: pendingHomePrompt.modelId ?? resolvedLaunchSelection.modelId,
      modeId: pendingHomePrompt.modeId ?? resolvedLaunchSelection.modeId,
      controlValues: {},
    };
    const outbox = {
      ...createPromptOutboxEntry({
        clientPromptId: pendingHomePrompt.id,
        clientSessionId: `web-pending:${pendingHomePrompt.id}`,
        materializedSessionId: null,
        workspaceId: workspace.id,
        text,
        blocks: [{ type: "text", text }],
      }),
      status: "dispatching" as const,
      deliveryState: "dispatching" as const,
      dispatchedAt: new Date().toISOString(),
    };
    setPendingPrompt(outbox);

    void (async () => {
      try {
        const connection = await workspaceContext.resolveConnection(workspace.id);
        const created = await createSession.mutateAsync({
          workspaceId: workspace.id,
          request: {
            workspaceId: connection.anyharnessWorkspaceId,
            agentKind: selection.agentKind,
            modelId: selection.modelId,
            modeId: selection.modeId,
          },
        });
        for (const update of pendingHomePrompt.sessionConfigUpdates ?? []) {
          await setConfigOption.mutateAsync({
            sessionId: created.id,
            request: {
              configId: update.configId,
              value: update.value,
            },
          });
        }
        await promptSession.mutateAsync({
          sessionId: created.id,
          request: {
            blocks: [{ type: "text", text }],
          },
        });
        clearPendingHomePrompt(workspace.id);
        setPendingHomePrompt(null);
        navigate(routes.chat(workspace.id, created.id), { replace: true });
        await sessionsQuery.refetch();
        window.setTimeout(() => setPendingPrompt(null), 800);
      } catch (error) {
        const message = errorMessage(error, "Prompt could not be sent.");
        const failedPrompt = {
          ...pendingHomePrompt,
          status: "failed" as const,
          errorMessage: message,
        };
        savePendingHomePrompt(workspace.id, failedPrompt);
        setPendingHomePrompt(failedPrompt);
        setPendingPrompt(null);
        setActionError(message);
      } finally {
        pendingHomePromptDispatchingRef.current = false;
      }
    })();
  }, [
    chatId,
    createSession,
    navigate,
    pendingHomePrompt,
    promptSession,
    resolvedLaunchSelection.agentKind,
    resolvedLaunchSelection.modeId,
    resolvedLaunchSelection.modelId,
    sessionsQuery,
    setConfigOption,
    workspace.id,
    workspaceContext,
  ]);

  const openNewSession = useCallback(() => {
    navigate(routes.workspace(workspace.id));
  }, [navigate, workspace.id]);

  const copyComposerFooterValue = useCallback(async (value: string) => {
    await navigator.clipboard.writeText(value);
    return true;
  }, []);

  const transcriptPlanActions = useMemo<CloudChatSurfaceProps["transcriptPlanActions"]>(() => ({
    approvePlan: (planId, expectedDecisionVersion) => {
      void approvePlan.mutateAsync({ planId, expectedDecisionVersion })
        .then(() => transcript.refetch())
        .catch((error) => setActionError(errorMessage(error, "Plan could not be approved.")));
    },
    rejectPlan: (planId, expectedDecisionVersion) => {
      void rejectPlan.mutateAsync({ planId, expectedDecisionVersion })
        .then(() => transcript.refetch())
        .catch((error) => setActionError(errorMessage(error, "Plan could not be rejected.")));
    },
    isApprovingPlan: (planId) => approvePlan.isPending && approvePlan.variables?.planId === planId,
    isRejectingPlan: (planId) => rejectPlan.isPending && rejectPlan.variables?.planId === planId,
  }), [approvePlan, rejectPlan, transcript]);

  if (sessionsQuery.isLoading && !sessionsQuery.data) {
    return { kind: "workspace-loading" };
  }

  if (chatId && !session && sessionsQuery.isFetched) {
    return { kind: "missing", title: "Chat not found" };
  }

  const runtimeMessage =
    actionError
    ?? (sessionsQuery.error ? errorMessage(sessionsQuery.error, "Cloud runtime unavailable.") : null)
    ?? (transcript.error ? errorMessage(transcript.error, "Transcript stream unavailable.") : null)
    ?? (launchOptions.error ? errorMessage(launchOptions.error, "Agent options unavailable.") : null);
  const runtimeReady = !sessionsQuery.error && !transcript.error;

  return {
    kind: "ready",
    surface: buildWebManagedSandboxChatSurfaceProps({
      workspace,
      session,
      sessions,
      transcriptState,
      transcriptLoading: transcript.isLoading,
      transcriptStatus: promptSession.isPending || createSession.isPending
        ? "Sending prompt."
        : transcript.streamConnectionState === "connecting" && session
          ? "Connecting to session stream."
          : null,
      sessionViewState,
      draft,
      onDraftChange: setDraft,
      onSubmitPrompt: () => void submitPrompt(),
      composerControls,
      promptSubmitting: promptSession.isPending || createSession.isPending,
      runtimeReady,
      runtimeMessage,
      onCopyComposerFooterValue: copyComposerFooterValue,
      onOpenNewSession: openNewSession,
      transcriptPlanActions,
      navigate,
    }),
  };
}

function createClientPromptId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `web-prompt:${Date.now()}:${Math.random()}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
