import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  desktopWorkspaceDeepLink,
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
  type CloudChatTranscriptRowView,
} from "@proliferate/product-ui/chat/CloudChatSurface";
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
import { buildCloudTranscriptView } from "../../../lib/domain/chat/cloud-transcript-view";

type PendingHomePromptDispatchRun = {
  key: string;
  active: boolean;
};

type OptimisticPromptStatus = "sending" | "queued" | "failed";

type OptimisticPrompt = {
  id: string;
  sessionId: string;
  text: string;
  baseTranscriptSeq: number;
  status: OptimisticPromptStatus;
};

const EMPTY_SESSION_EVENTS: CloudSessionEvent[] = [];
const EMPTY_TRANSCRIPT_ITEMS: CloudTranscriptItem[] = [];
const DEFAULT_DIRECT_PROMPT_MODEL_ID = "gpt-5.4";

export function ChatScreen() {
  const { workspaceId, chatId } = useParams();
  const navigate = useNavigate();
  const client = useCloudClient();
  const [draft, setDraft] = useState("");
  const [latestCommandId, setLatestCommandId] = useState<string | null>(null);
  const [directPromptDispatching, setDirectPromptDispatching] = useState(false);
  const [optimisticPrompts, setOptimisticPrompts] = useState<OptimisticPrompt[]>([]);
  const [pendingHomePrompt, setPendingHomePrompt] = useState<PendingHomePrompt | null>(() =>
    workspaceId ? loadPendingHomePrompt(workspaceId) : null
  );
  const [pendingHomePromptStatus, setPendingHomePromptStatus] = useState<string | null>(null);
  const pendingHomePromptDispatchRunRef = useRef<PendingHomePromptDispatchRun | null>(null);
  const workspaceQuery = useCloudWorkspaceSnapshot(workspaceId ?? null, Boolean(workspaceId));
  const workspaceLive = useWorkspaceLive(workspaceId ?? null, { enabled: Boolean(workspaceId) });
  const snapshot = workspaceLive.snapshot ?? workspaceQuery.data;
  const workspace = snapshot?.workspace;
  const workspaceStatus = workspace ? effectiveWorkspaceStatus(workspace) : null;
  const sessions = useMemo(
    () => [...(snapshot?.sessions ?? [])].sort(compareSessions),
    [snapshot?.sessions],
  );
  const session =
    sessions.find((candidate) => candidate.sessionId === chatId) ?? sessions[0] ?? null;
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
        sessionId: session?.sessionId ?? null,
        transcriptItems,
        transcriptRows: transcriptView.rows,
      }),
    ],
    [optimisticPrompts, session?.sessionId, transcriptItems, transcriptView.rows],
  );
  const enqueuePrompt = useEnqueueCloudCommand<SendPromptPayload>();
  const enqueueStartSession = useEnqueueCloudCommand<StartSessionPayload>();
  const claimWorkspace = useClaimCloudWorkspace();
  const commandStatus = useCommandStatus(latestCommandId);
  const isUnclaimed = workspace?.visibility === "shared_unclaimed";
  const workspaceReadyAgentKindsKey = workspace?.readyAgentKinds?.join("\0") ?? "";
  const workspaceAllowedAgentKindsKey = workspace?.allowedAgentKinds?.join("\0") ?? "";

  useEffect(() => {
    setPendingHomePrompt(workspaceId ? loadPendingHomePrompt(workspaceId) : null);
    setPendingHomePromptStatus(null);
    setOptimisticPrompts([]);
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
      setDirectPromptDispatching(true);
      setPendingHomePromptStatus("Starting a session for this prompt.");
      const pendingPrompt: PendingHomePrompt = {
        id: `web-chat:${workspace.id}:${Date.now().toString(36)}`,
        text,
        modelId: DEFAULT_DIRECT_PROMPT_MODEL_ID,
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
        setDraft("");
        setPendingHomePromptStatus(null);
        await workspaceQuery.refetch();
        navigate(routes.chat(workspace.id, sessionId));
      } catch (error) {
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
        payload: { text },
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
          label: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
          icon: "branch",
        },
        {
          id: "repo",
          label: `${workspace.repo.owner}/${workspace.repo.name}`,
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
      desktopHref={desktopWorkspaceDeepLink(workspace.id)}
      composer={{
        value: draft,
        onChange: setDraft,
        onSubmit: () => void submitPrompt(),
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
  sessionId: string | null;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
}): CloudChatTranscriptRowView[] {
  if (!input.sessionId) {
    return [];
  }
  const rows: CloudChatTranscriptRowView[] = [];
  for (const prompt of input.prompts) {
    if (prompt.sessionId !== input.sessionId) {
      continue;
    }
    const promptVisible = transcriptHasUserPrompt(
      prompt,
      input.transcriptItems,
      input.transcriptRows,
    );
    const agentStarted = transcriptHasAgentProgressAfterPrompt(
      prompt,
      input.transcriptItems,
      input.transcriptRows,
    );
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
