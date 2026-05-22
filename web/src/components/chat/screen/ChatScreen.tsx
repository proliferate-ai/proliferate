import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  desktopWorkspaceDeepLink,
  type CloudCommandStatus,
  type CloudSessionEvent,
  type CloudSessionProjection,
  type CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  useClaimCloudWorkspace,
  useCloudClient,
  useCloudSessionEvents,
  useCloudTranscriptSnapshot,
  useCloudWorkspaceSnapshot,
  useCommandStatus,
  useEnqueueCloudCommand,
  useSessionLive,
  useWorkspaceLive,
} from "@proliferate/cloud-sdk-react";
import {
  CloudChatSurface,
} from "@proliferate/product-ui/chat/CloudChatSurface";
import type {
  CloudChatComposerFooterControlView,
} from "@proliferate/product-ui/chat/CloudChatComposer";
import type {
  CloudChatTranscriptRowView,
} from "@proliferate/product-ui/chat/CloudChatTranscript";
import { Button } from "@proliferate/ui/primitives/Button";

import { routes } from "../../../config/routes";
import {
  dispatchPendingHomePrompt,
  type SendPromptPayload,
  type StartSessionPayload,
} from "../../../lib/access/cloud/pending-home-prompt-dispatch";
import {
  clearPendingHomePrompt,
  loadPendingHomePrompt,
  type PendingHomePrompt,
} from "../../../lib/access/cloud/pending-home-prompt-store";
import {
  buildCloudChatComposerControls,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  getLiveConfigControlValue,
  pendingConfigChangeKey,
  readSessionLiveConfig,
  type PendingConfigChange,
} from "../../../lib/domain/chat/cloud-composer-controls";
import { buildCloudTranscriptView } from "../../../lib/domain/chat/cloud-transcript-view";

type PendingHomePromptDispatchRun = {
  key: string;
  active: boolean;
};

type OptimisticPromptStatus = "sending" | "queued" | "failed";

type OptimisticPrompt = {
  id: string;
  workspaceId: string;
  sessionId: string | null;
  text: string;
  baseTranscriptSeq: number;
  status: OptimisticPromptStatus;
};

type UpdateSessionConfigPayload = {
  configId: string;
  value: string;
};

const EMPTY_SESSION_EVENTS: CloudSessionEvent[] = [];
const EMPTY_TRANSCRIPT_ITEMS: CloudTranscriptItem[] = [];

export function ChatScreen() {
  const { workspaceId, chatId } = useParams();
  const navigate = useNavigate();
  const client = useCloudClient();
  const [draft, setDraft] = useState("");
  const [draftModelId, setDraftModelId] = useState(DEFAULT_DIRECT_PROMPT_MODEL_ID);
  const [latestCommandId, setLatestCommandId] = useState<string | null>(null);
  const [latestConfigCommandId, setLatestConfigCommandId] = useState<string | null>(null);
  const [directPromptDispatching, setDirectPromptDispatching] = useState(false);
  const [optimisticPrompts, setOptimisticPrompts] = useState<OptimisticPrompt[]>([]);
  const [pendingConfigChanges, setPendingConfigChanges] = useState<
    Record<string, PendingConfigChange>
  >({});
  const [pendingHomePrompt, setPendingHomePrompt] = useState<PendingHomePrompt | null>(() =>
    workspaceId ? loadPendingHomePrompt(workspaceId) : null
  );
  const [pendingHomePromptStatus, setPendingHomePromptStatus] = useState<string | null>(null);
  const pendingHomePromptDispatchRunRef = useRef<PendingHomePromptDispatchRun | null>(null);
  const pendingConfigMutationIdRef = useRef(0);
  const workspaceQuery = useCloudWorkspaceSnapshot(workspaceId ?? null, Boolean(workspaceId));
  const workspaceLive = useWorkspaceLive(workspaceId ?? null, { enabled: Boolean(workspaceId) });
  const snapshot = workspaceLive.snapshot ?? workspaceQuery.data;
  const workspace = snapshot?.workspace;
  const workspaceStatus = workspace ? effectiveWorkspaceStatus(workspace) : null;
  const sessions = useMemo(
    () => [...(snapshot?.sessions ?? [])].sort(compareSessions),
    [snapshot?.sessions],
  );
  const session = chatId
    ? sessions.find((candidate) => candidate.sessionId === chatId) ?? null
    : null;
  const sessionLive = useSessionLive(session?.sessionId ?? null, {
    targetId: session?.targetId ?? null,
    enabled: Boolean(session),
  });
  const transcriptQuery = useCloudTranscriptSnapshot(
    session?.targetId ?? null,
    session?.sessionId ?? null,
    Boolean(session),
  );
  const sessionEventsQuery = useCloudSessionEvents(
    session?.targetId ?? null,
    session?.sessionId ?? null,
    Boolean(session),
  );
  const transcriptItems = sessionLive.snapshot?.transcriptItems
    ?? transcriptQuery.data?.transcriptItems
    ?? EMPTY_TRANSCRIPT_ITEMS;
  const sessionEvents = sessionEventsQuery.data?.events ?? EMPTY_SESSION_EVENTS;
  const transcriptView = useMemo(
    () => buildCloudTranscriptView({
      sessionId: session?.sessionId ?? null,
      events: sessionEvents,
      fallbackItems: transcriptItems,
    }),
    [session?.sessionId, sessionEvents, transcriptItems],
  );
  const visibleTranscriptRows = useMemo(
    () => [
      ...transcriptView.rows,
      ...buildOptimisticPromptRows({
        prompts: optimisticPrompts,
        workspaceId: workspace?.id ?? null,
        sessionId: session?.sessionId ?? null,
        transcriptItems,
        transcriptRows: transcriptView.rows,
      }),
      ...buildPendingHomePromptRows({
        pendingPrompt: pendingHomePrompt,
        workspaceId: workspace?.id ?? null,
        sessionId: session?.sessionId ?? null,
        status: pendingHomePromptStatus,
        optimisticPrompts,
      }),
    ],
    [
      optimisticPrompts,
      pendingHomePrompt,
      pendingHomePromptStatus,
      session?.sessionId,
      transcriptItems,
      transcriptView.rows,
      workspace?.id,
    ],
  );
  const enqueuePrompt = useEnqueueCloudCommand<SendPromptPayload>();
  const enqueueStartSession = useEnqueueCloudCommand<StartSessionPayload>();
  const enqueueConfig = useEnqueueCloudCommand<UpdateSessionConfigPayload>();
  const claimWorkspace = useClaimCloudWorkspace();
  const commandStatus = useCommandStatus(latestCommandId);
  const configCommandStatus = useCommandStatus(latestConfigCommandId);
  const isUnclaimed = workspace?.visibility === "shared_unclaimed";
  const workspaceReadyAgentKindsKey = workspace?.readyAgentKinds?.join("\0") ?? "";
  const workspaceAllowedAgentKindsKey = workspace?.allowedAgentKinds?.join("\0") ?? "";
  const liveConfig = readSessionLiveConfig(session);
  const composerControls = buildCloudChatComposerControls({
    session,
    liveConfig,
    pendingConfigChanges,
    launchModelId: draftModelId,
    onLaunchModelSelect: setDraftModelId,
    onSessionConfigSelect: (rawConfigId, value) => {
      void submitSessionConfig(rawConfigId, value);
    },
  });

  useEffect(() => {
    setPendingHomePrompt(workspaceId ? loadPendingHomePrompt(workspaceId) : null);
    setPendingHomePromptStatus(null);
    setOptimisticPrompts([]);
    setPendingConfigChanges({});
    setLatestConfigCommandId(null);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !workspace || workspaceStatus === "ready" || workspaceStatus === "error") {
      return;
    }
    const interval = window.setInterval(() => {
      void workspaceQuery.refetch();
    }, 2500);
    return () => {
      window.clearInterval(interval);
    };
  }, [workspace, workspaceStatus, workspaceId, workspaceQuery.refetch]);

  useEffect(() => {
    if (!pendingHomePrompt || !workspace) {
      return;
    }
    if (workspaceStatus === "error" || workspaceStatus === "archived") {
      setPendingHomePromptStatus("Workspace creation failed before the prompt could be sent.");
      return;
    }
    if (workspaceStatus !== "ready") {
      setPendingHomePromptStatus("Workspace is provisioning; the prompt will send when ready.");
      return;
    }

    const runKey = `${workspace.id}:${pendingHomePrompt.id}`;
    const currentRun = pendingHomePromptDispatchRunRef.current;
    if (currentRun?.key === runKey && currentRun.active) {
      return;
    }

    const run: PendingHomePromptDispatchRun = { key: runKey, active: true };
    pendingHomePromptDispatchRunRef.current = run;
    const isCurrentRun = () => pendingHomePromptDispatchRunRef.current === run && run.active;
    const setCurrentStatus = (status: string) => {
      if (isCurrentRun()) {
        setPendingHomePromptStatus(status);
      }
    };

    setPendingHomePromptStatus("Starting a session for the queued prompt.");
    const timeoutId = window.setTimeout(() => {
      if (!isCurrentRun()) {
        return;
      }
      void dispatchPendingHomePrompt({
        client,
        workspace,
        pendingPrompt: pendingHomePrompt,
        modelId: pendingHomePrompt.modelId,
        enqueueStartSession: enqueueStartSession.mutateAsync,
        enqueuePrompt: enqueuePrompt.mutateAsync,
        setLatestCommandId: (commandId) => {
          if (isCurrentRun()) {
            setLatestCommandId(commandId);
          }
        },
        onStatus: setCurrentStatus,
        shouldContinue: isCurrentRun,
      })
        .then((sessionId) => {
          if (!isCurrentRun()) {
            return;
          }
          setOptimisticPrompts((current) =>
            current.some((prompt) => prompt.id === pendingHomePrompt.id)
              ? current
              : [
                ...current,
                {
                  id: pendingHomePrompt.id,
                  workspaceId: workspace.id,
                  sessionId,
                  text: pendingHomePrompt.text,
                  baseTranscriptSeq: 0,
                  status: "queued",
                },
              ]
          );
          clearPendingHomePrompt(workspace.id);
          setPendingHomePrompt(null);
          setPendingHomePromptStatus(null);
          void workspaceQuery.refetch();
          navigate(routes.chat(workspace.id, sessionId), { replace: true });
        })
        .catch((error: unknown) => {
          if (!isCurrentRun()) {
            return;
          }
          setPendingHomePromptStatus(
            error instanceof Error ? error.message : "Queued prompt could not be sent.",
          );
        })
        .finally(() => {
          if (pendingHomePromptDispatchRunRef.current === run) {
            pendingHomePromptDispatchRunRef.current = null;
          }
        });
    }, 0);
    return () => {
      run.active = false;
      window.clearTimeout(timeoutId);
    };
  }, [
    client,
    enqueuePrompt.mutateAsync,
    enqueueStartSession.mutateAsync,
    navigate,
    pendingHomePrompt,
    workspace?.anyharnessWorkspaceId,
    workspace?.id,
    workspace?.targetId,
    workspaceStatus,
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    workspaceQuery.refetch,
  ]);

  useEffect(() => {
    if (!session || !sessionLive.lastPatchAt) {
      return;
    }
    void transcriptQuery.refetch();
    void sessionEventsQuery.refetch();
  }, [
    session?.sessionId,
    sessionLive.lastPatchAt,
    sessionEventsQuery.refetch,
    transcriptQuery.refetch,
  ]);

  useEffect(() => {
    if (session && !pendingHomePrompt && !directPromptDispatching) {
      setPendingHomePromptStatus(null);
    }
  }, [directPromptDispatching, pendingHomePrompt, session?.sessionId]);

  useEffect(() => {
    if (!session) {
      return;
    }
    setOptimisticPrompts((current) =>
      current.filter((prompt) =>
        prompt.sessionId !== session.sessionId
        || prompt.status === "failed"
        || !transcriptHasAgentProgressAfterPrompt(prompt, transcriptItems, transcriptView.rows)
      )
    );
  }, [session?.sessionId, transcriptItems, transcriptView.rows]);

  useEffect(() => {
    if (!session || !liveConfig) {
      return;
    }
    setPendingConfigChanges((current) => {
      let changed = false;
      const next = { ...current };
      for (const [key, pendingChange] of Object.entries(current)) {
        if (pendingChange.sessionId !== session.sessionId) {
          continue;
        }
        if (getLiveConfigControlValue(liveConfig, pendingChange.rawConfigId) === pendingChange.value) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [liveConfig, session?.sessionId]);

  useEffect(() => {
    const command = configCommandStatus.data;
    if (!command || !isRejectedCommandStatus(command.status)) {
      return;
    }
    if (
      !Object.values(pendingConfigChanges).some((change) =>
        change.commandId === command.commandId
      )
    ) {
      return;
    }
    setPendingConfigChanges((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([_key, change]) =>
          change.commandId !== command.commandId
        ),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setPendingHomePromptStatus(
      command.errorMessage || sessionConfigCommandFailureMessage(command.status),
    );
  }, [
    configCommandStatus.data?.commandId,
    configCommandStatus.data?.errorMessage,
    configCommandStatus.data?.status,
    pendingConfigChanges,
  ]);

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !workspace) {
      return;
    }
    if (!session) {
      if (workspaceStatus !== "ready") {
        setPendingHomePromptStatus("Workspace is provisioning; the prompt will send when ready.");
        return;
      }
      if (directPromptDispatching) {
        return;
      }
      const promptId = `web-chat:${workspace.id}:${Date.now().toString(36)}`;
      const optimisticPrompt: OptimisticPrompt = {
        id: promptId,
        workspaceId: workspace.id,
        sessionId: null,
        text,
        baseTranscriptSeq: 0,
        status: "sending",
      };
      setOptimisticPrompts((current) => [...current, optimisticPrompt]);
      setDraft("");
      setDirectPromptDispatching(true);
      setPendingHomePromptStatus("Starting a session for this prompt.");
      const pendingPrompt: PendingHomePrompt = {
        id: promptId,
        text,
        modelId: draftModelId,
        modeId: null,
        createdAt: Date.now(),
      };
      try {
        const sessionId = await dispatchPendingHomePrompt({
          client,
          workspace,
          pendingPrompt,
          modelId: pendingPrompt.modelId,
          enqueueStartSession: enqueueStartSession.mutateAsync,
          enqueuePrompt: enqueuePrompt.mutateAsync,
          setLatestCommandId,
          onStatus: setPendingHomePromptStatus,
          shouldContinue: () => true,
        });
        setOptimisticPrompts((current) =>
          current.map((prompt) =>
            prompt.id === optimisticPrompt.id
              ? { ...prompt, sessionId, status: "queued" }
              : prompt
          )
        );
        setPendingHomePromptStatus(null);
        await workspaceQuery.refetch();
        navigate(routes.chat(workspace.id, sessionId));
      } catch (error) {
        setOptimisticPrompts((current) =>
          current.map((prompt) =>
            prompt.id === optimisticPrompt.id ? { ...prompt, status: "failed" } : prompt
          )
        );
        setPendingHomePromptStatus(
          error instanceof Error ? error.message : "Prompt could not be sent.",
        );
      } finally {
        setDirectPromptDispatching(false);
      }
      return;
    }
    const optimisticPrompt: OptimisticPrompt = {
      id: `web:${workspace.id}:${session.sessionId}:${Date.now()}`,
      workspaceId: workspace.id,
      sessionId: session.sessionId,
      text,
      baseTranscriptSeq: latestTranscriptItemSeq(transcriptItems),
      status: "sending",
    };
    setOptimisticPrompts((current) => [...current, optimisticPrompt]);
    setDraft("");
    setPendingHomePromptStatus(null);
    try {
      const command = await enqueuePrompt.mutateAsync({
        idempotencyKey: optimisticPrompt.id,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: session.sessionId,
        kind: "send_prompt",
        source: "web",
        payload: { text, promptId: optimisticPrompt.id },
      });
      setLatestCommandId(command.commandId);
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "queued" } : prompt
        )
      );
      void transcriptQuery.refetch();
      void sessionEventsQuery.refetch();
    } catch (error) {
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "failed" } : prompt
        )
      );
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : "Prompt could not be sent.",
      );
    }
  }

  async function submitSessionConfig(rawConfigId: string, value: string) {
    if (!workspace || !session) {
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
      const command = await enqueueConfig.mutateAsync({
        idempotencyKey: `web:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${value}:${mutationId}`,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: session.sessionId,
        kind: "update_session_config",
        source: "web",
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

  if (!workspaceId) {
    return <MissingState title="Workspace not found" />;
  }

  if (workspaceQuery.isLoading && !snapshot) {
    return <MissingState title="Loading workspace" />;
  }

  if (workspaceQuery.error || !workspace) {
    return <MissingState title="Workspace not available" />;
  }

  const workspaceCommandReady = workspaceStatus === "ready"
    && Boolean(workspace.targetId)
    && Boolean(workspace.anyharnessWorkspaceId);
  const promptSubmitting = enqueuePrompt.isPending || directPromptDispatching;
  const canSubmit = Boolean(
    draft.trim()
      && !isUnclaimed
      && !promptSubmitting
      && (session ? true : workspaceCommandReady),
  );
  const sessionTitle = session?.title ?? workspace.displayName ?? workspace.repo.name;
  const commandMessage =
    pendingHomePromptStatus ??
    commandStatus.data?.errorMessage ??
    (commandStatus.data?.status ? `Command ${commandStatus.data.status}` : null);
  const transcriptSourceLabel = transcriptView.source === "events"
    ? "Event transcript"
    : transcriptView.source === "projection"
      ? "Projection fallback"
      : "No transcript";
  const branchName = workspace.repo.branch ?? workspace.repo.baseBranch ?? "main";
  const repoLabel = `${workspace.repo.owner}/${workspace.repo.name}`;
  const composerFooterControls: CloudChatComposerFooterControlView[] = [
    {
      id: "branch",
      label: branchName,
      detail: "Branch",
      icon: "branch",
      title: "Copy branch name",
      onClick: () => copyComposerValue("Branch", branchName, setPendingHomePromptStatus),
    },
    {
      id: "repo",
      label: repoLabel,
      detail: "Repo",
      icon: "repo",
      title: "Copy repository name",
      onClick: () => copyComposerValue("Repository", repoLabel, setPendingHomePromptStatus),
    },
    {
      id: "cloud-status",
      label: sessionLive.isConnected ? "Live" : workspaceStatusLabel(workspaceStatus),
      detail: sessionLive.isConnected ? "Runtime" : "Workspace",
      icon: "cloud",
      active: sessionLive.isConnected,
      title: sessionLive.isConnected ? "Cloud runtime stream is connected" : "Cloud workspace status",
    },
    ...(isUnclaimed
      ? [{
        id: "claim",
        label: "Claim workspace",
        detail: "Shared",
        icon: "users" as const,
        active: true,
        pending: claimWorkspace.isPending,
        title: "Claim this shared workspace",
        onClick: () => claimWorkspace.mutate({ workspaceId: workspace.id }),
      }]
      : []),
  ];
  const emptyTitle = !session
    ? "No active session yet."
    : sessionEventsQuery.isLoading && transcriptView.source === "empty"
      ? "Loading transcript"
      : "Waiting for the first projected transcript event.";

  return (
    <CloudChatSurface
      title={sessionTitle}
      eyebrowItems={[
        workspace.sandboxType ?? "cloud",
        workspace.exposureState ?? "tracked",
        session?.status ?? workspaceStatus ?? "unknown",
      ]}
      chips={[
        {
          id: "branch",
          label: branchName,
          icon: "branch",
        },
        {
          id: "repo",
          label: repoLabel,
        },
        ...(workspace.visibility !== "private"
          ? [{ id: "visibility", label: workspace.visibility }]
          : []),
        {
          id: "live",
          label: sessionLive.isConnected ? "Live" : "Snapshot",
        },
        {
          id: "source",
          label: transcriptSourceLabel,
        },
      ]}
      transcriptRows={visibleTranscriptRows}
      emptyTitle={emptyTitle}
      emptyDescription={
        !session ? "Send a prompt below to start the first projected session." : undefined
      }
      commandMessage={commandMessage}
      primaryAction={isUnclaimed
        ? {
          label: "Claim",
          kind: "claim",
          loading: claimWorkspace.isPending,
          onClick: () => claimWorkspace.mutate({ workspaceId: workspace.id }),
        }
        : null}
      headerActions={session
        ? [{
          id: "new-session",
          label: "New chat",
          kind: "new-session",
          onClick: () => navigate(routes.workspace(workspace.id)),
        }]
        : []}
      desktopHref={desktopWorkspaceDeepLink(workspace.id)}
      composer={{
        value: draft,
        onChange: setDraft,
        onSubmit: () => void submitPrompt(),
        controls: composerControls,
        footerControls: composerFooterControls,
        disabled: isUnclaimed || (!session && !workspaceCommandReady),
        canSubmit,
        isSubmitting: promptSubmitting,
        placeholder: isUnclaimed
          ? "Claim this workspace to reply"
          : session
            ? "Message this session"
            : workspaceCommandReady
              ? "Start a session with a message"
              : "Waiting for workspace",
      }}
      onBack={() => navigate(routes.workspaces)}
    />
  );
}

function MissingState({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <Button className="mt-4" onClick={() => navigate(routes.workspaces)}>
          Go to workspaces
        </Button>
      </div>
    </div>
  );
}

function compareSessions(left: CloudSessionProjection, right: CloudSessionProjection): number {
  return (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
}

function effectiveWorkspaceStatus(
  workspace: { status?: string | null; workspaceStatus?: string | null },
): string | null {
  return workspace.workspaceStatus ?? workspace.status ?? null;
}

function buildOptimisticPromptRows(input: {
  prompts: readonly OptimisticPrompt[];
  workspaceId: string | null;
  sessionId: string | null;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
}): CloudChatTranscriptRowView[] {
  if (!input.workspaceId) {
    return [];
  }
  const rows: CloudChatTranscriptRowView[] = [];
  for (const prompt of input.prompts) {
    if (prompt.workspaceId !== input.workspaceId) {
      continue;
    }
    if (input.sessionId) {
      if (prompt.sessionId !== input.sessionId) {
        continue;
      }
    } else if (prompt.sessionId !== null) {
      continue;
    }
    const promptVisible = input.sessionId
      ? transcriptHasUserPrompt(prompt, input.transcriptItems, input.transcriptRows)
      : false;
    const agentStarted = input.sessionId
      ? transcriptHasAgentProgressAfterPrompt(prompt, input.transcriptItems, input.transcriptRows)
      : false;
    if (!promptVisible) {
      rows.push({
        id: `${prompt.id}:user`,
        kind: "user",
        body: prompt.text,
        status: optimisticPromptStatusLabel(prompt.status),
        streaming: prompt.status !== "failed",
      });
    }
    if (prompt.status !== "failed" && !agentStarted) {
      rows.push({
        id: `${prompt.id}:assistant-waiting`,
        kind: "assistant",
        body: prompt.status === "sending" ? "Sending message..." : "Waiting for response...",
        streaming: true,
      });
    }
  }
  return rows;
}

function buildPendingHomePromptRows(input: {
  pendingPrompt: PendingHomePrompt | null;
  workspaceId: string | null;
  sessionId: string | null;
  status: string | null;
  optimisticPrompts: readonly OptimisticPrompt[];
}): CloudChatTranscriptRowView[] {
  if (!input.pendingPrompt || !input.workspaceId || input.sessionId) {
    return [];
  }
  const duplicateOptimisticPrompt = input.optimisticPrompts.some((prompt) =>
    prompt.workspaceId === input.workspaceId
    && prompt.sessionId === null
    && textMatches(prompt.text, input.pendingPrompt!.text)
  );
  if (duplicateOptimisticPrompt) {
    return [];
  }
  const failed = input.status?.toLowerCase().includes("failed") ?? false;
  return [
    {
      id: `${input.pendingPrompt.id}:user`,
      kind: "user",
      body: input.pendingPrompt.text,
      status: failed ? "Failed" : "Queued",
      streaming: !failed,
    },
    {
      id: `${input.pendingPrompt.id}:assistant-waiting`,
      kind: failed ? "error" : "assistant",
      body: failed
        ? input.status ?? "Queued prompt could not be sent."
        : input.status ?? "Waiting for the workspace to be ready...",
      streaming: !failed,
    },
  ];
}

function optimisticPromptStatusLabel(status: OptimisticPromptStatus): string {
  switch (status) {
    case "failed":
      return "Failed";
    case "queued":
      return "Queued";
    case "sending":
    default:
      return "Sending";
  }
}

function transcriptHasUserPrompt(
  prompt: OptimisticPrompt,
  transcriptItems: readonly CloudTranscriptItem[],
  transcriptRows: readonly CloudChatTranscriptRowView[],
): boolean {
  return transcriptItems.some((item) => isPromptItemForOptimisticPrompt(item, prompt))
    || (
      transcriptItems.length === 0
      && transcriptRows.some((row) => row.kind === "user" && textMatches(row.body, prompt.text))
    );
}

function transcriptHasAgentProgressAfterPrompt(
  prompt: OptimisticPrompt,
  transcriptItems: readonly CloudTranscriptItem[],
  transcriptRows: readonly CloudChatTranscriptRowView[],
): boolean {
  const promptItem = [...transcriptItems]
    .filter((item) => isPromptItemForOptimisticPrompt(item, prompt))
    .sort((left, right) => right.lastSeq - left.lastSeq)[0];
  if (promptItem) {
    return transcriptItems.some((item) =>
      item.firstSeq > promptItem.lastSeq && !isPromptTranscriptKind(item.kind)
    );
  }
  if (transcriptItems.length > 0) {
    return false;
  }

  const promptRowIndex = transcriptRows.findIndex((row) =>
    row.kind === "user" && textMatches(row.body, prompt.text)
  );
  if (promptRowIndex === -1) {
    return false;
  }
  return transcriptRows
    .slice(promptRowIndex + 1)
    .some((row) => row.kind !== "user");
}

function isPromptItemForOptimisticPrompt(
  item: CloudTranscriptItem,
  prompt: OptimisticPrompt,
): boolean {
  return item.firstSeq > prompt.baseTranscriptSeq
    && isPromptTranscriptKind(item.kind)
    && textMatches(item.text, prompt.text);
}

function isPromptTranscriptKind(kind: string | null | undefined): boolean {
  return kind === "user_message" || kind === "prompt";
}

function textMatches(value: string | null | undefined, expected: string): boolean {
  return normalizePromptText(value) === normalizePromptText(expected);
}

function normalizePromptText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function latestTranscriptItemSeq(items: readonly CloudTranscriptItem[]): number {
  return items.reduce((maxSeq, item) => Math.max(maxSeq, item.lastSeq), 0);
}

function isRejectedCommandStatus(status: CloudCommandStatus): boolean {
  return status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

function sessionConfigCommandFailureMessage(status: CloudCommandStatus): string {
  switch (status) {
    case "expired":
      return "Session configuration update expired before it was applied.";
    case "superseded":
      return "Session configuration update was superseded.";
    case "failed_delivery":
      return "Session configuration update could not be delivered.";
    case "rejected":
    default:
      return "Session configuration update was rejected.";
  }
}

function workspaceStatusLabel(status: string | null): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "materializing":
    case "provisioning":
      return "Starting";
    case "error":
      return "Error";
    case "archived":
      return "Archived";
    default:
      return status ?? "Cloud";
  }
}

function copyComposerValue(
  label: string,
  value: string,
  setStatus: (status: string | null) => void,
): void {
  const clipboard = window.navigator.clipboard;
  if (!clipboard) {
    setStatus(`${label} copy is not available in this browser.`);
    return;
  }
  void clipboard.writeText(value)
    .then(() => setStatus(`${label} copied.`))
    .catch(() => setStatus(`${label} could not be copied.`));
}
