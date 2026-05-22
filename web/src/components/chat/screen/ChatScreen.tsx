import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  MoreHorizontal,
  Send,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  desktopWorkspaceDeepLink,
  type CloudSessionProjection,
  type CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  useClaimCloudWorkspace,
  useCloudClient,
  useCloudTranscriptSnapshot,
  useCloudWorkspaceSnapshot,
  useCommandStatus,
  useEnqueueCloudCommand,
  useSessionLive,
  useWorkspaceLive,
} from "@proliferate/cloud-sdk-react";

import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

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

type PendingHomePromptDispatchRun = {
  key: string;
  active: boolean;
};

export function ChatScreen() {
  const { workspaceId, chatId } = useParams();
  const navigate = useNavigate();
  const client = useCloudClient();
  const [draft, setDraft] = useState("");
  const [latestCommandId, setLatestCommandId] = useState<string | null>(null);
  const [pendingHomePrompt, setPendingHomePrompt] = useState<PendingHomePrompt | null>(() =>
    workspaceId ? loadPendingHomePrompt(workspaceId) : null
  );
  const [pendingHomePromptStatus, setPendingHomePromptStatus] = useState<string | null>(null);
  const pendingHomePromptDispatchRunRef = useRef<PendingHomePromptDispatchRun | null>(null);
  const workspaceQuery = useCloudWorkspaceSnapshot(workspaceId ?? null, Boolean(workspaceId));
  const workspaceLive = useWorkspaceLive(workspaceId ?? null, { enabled: Boolean(workspaceId) });
  const snapshot = workspaceLive.snapshot ?? workspaceQuery.data;
  const workspace = snapshot?.workspace;
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
  const transcriptItems =
    sessionLive.snapshot?.transcriptItems ?? transcriptQuery.data?.transcriptItems ?? [];
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
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !workspace || workspace.status === "ready" || workspace.status === "error") {
      return;
    }
    const interval = window.setInterval(() => {
      void workspaceQuery.refetch();
    }, 2500);
    return () => {
      window.clearInterval(interval);
    };
  }, [workspace?.status, workspaceId, workspaceQuery.refetch]);

  useEffect(() => {
    if (!pendingHomePrompt || !workspace) {
      return;
    }
    if (workspace.status === "error" || workspace.status === "archived") {
      setPendingHomePromptStatus("Workspace creation failed before the prompt could be sent.");
      return;
    }
    if (workspace.status !== "ready") {
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
    workspace?.status,
    workspace?.targetId,
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    workspaceQuery.refetch,
  ]);

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !workspace || !session) {
      return;
    }
    const command = await enqueuePrompt.mutateAsync({
      idempotencyKey: `web:${workspace.id}:${session.sessionId}:${Date.now()}`,
      targetId: session.targetId,
      workspaceId: session.workspaceId,
      cloudWorkspaceId: workspace.id,
      sessionId: session.sessionId,
      kind: "send_prompt",
      source: "web",
      payload: { text },
    });
    setLatestCommandId(command.commandId);
    setDraft("");
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

  const canSubmit = Boolean(draft.trim() && session && !enqueuePrompt.isPending && !isUnclaimed);
  const sessionTitle = session?.title ?? workspace.displayName ?? workspace.repo.name;
  const commandMessage =
    pendingHomePromptStatus ??
    commandStatus.data?.errorMessage ??
    (commandStatus.data?.status ? `Command ${commandStatus.data.status}` : null);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <IconButton title="Back" onClick={() => navigate(routes.workspaces)}>
          <ArrowLeft size={16} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{workspace.sandboxType ?? "cloud"}</span>
            <span>-</span>
            <span>{workspace.exposureState ?? "tracked"}</span>
            <span>-</span>
            <span>{session?.status ?? workspace.status}</span>
          </div>
          <h1 className="truncate text-sm font-semibold">{sessionTitle}</h1>
        </div>
        {isUnclaimed && (
          <Button
            variant="secondary"
            size="sm"
            loading={claimWorkspace.isPending}
            onClick={() => claimWorkspace.mutate({ workspaceId: workspace.id })}
          >
            <Users size={14} />
            Claim
          </Button>
        )}
        <a
          href={desktopWorkspaceDeepLink(workspace.id)}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-input px-3 text-xs text-muted-foreground hover:bg-accent"
        >
          <ExternalLink size={14} />
          Desktop
        </a>
        <IconButton title="Session menu">
          <MoreHorizontal size={16} />
        </IconButton>
      </header>

      <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
              <GitBranch size={13} />
              {workspace.repo.branch ?? workspace.repo.baseBranch ?? "main"}
            </span>
            <span className="rounded-md border border-border px-2 py-1">
              {workspace.repo.owner}/{workspace.repo.name}
            </span>
            {workspace.visibility !== "private" && (
              <span className="rounded-md border border-border px-2 py-1">
                {workspace.visibility}
              </span>
            )}
            <span className="rounded-md border border-border px-2 py-1">
              {sessionLive.isConnected ? "Live" : "Snapshot"}
            </span>
          </div>

          {!session ? (
            <div className="rounded-lg border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
              No projected sessions are available for this workspace yet.
            </div>
          ) : transcriptItems.length > 0 ? (
            <div className="space-y-3">
              {transcriptItems.map((item) => (
                <TranscriptMessage key={item.itemId} item={item} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
              Waiting for the first projected transcript event.
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border p-4">
        <form
          onSubmit={(event) => void submitPrompt(event)}
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-input bg-card p-2"
        >
          <Textarea
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            disabled={!session}
            className="min-h-10 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            placeholder={
              isUnclaimed
                ? "Claim this workspace to reply"
                : session
                  ? "Message this session"
                  : "No active projected session"
            }
          />
          <Button size="icon" aria-label="Send message" disabled={!canSubmit}>
            <Send size={15} />
          </Button>
        </form>
        {commandMessage && (
          <p className="mx-auto mt-2 max-w-3xl text-xs text-muted-foreground">{commandMessage}</p>
        )}
      </footer>
    </div>
  );
}

function TranscriptMessage({ item }: { item: CloudTranscriptItem }) {
  const role = transcriptRole(item);
  return (
    <article
      className={`rounded-lg border border-border p-4 ${
        role === "assistant" ? "bg-card" : "bg-background"
      }`}
    >
      <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">{role}</div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
        {item.text ?? item.title ?? item.kind ?? "Projected event"}
      </p>
    </article>
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

function transcriptRole(item: CloudTranscriptItem): "user" | "assistant" | "system" {
  if (item.kind === "user_message" || item.kind === "prompt") {
    return "user";
  }
  if (item.kind === "system" || item.kind === "tool") {
    return "system";
  }
  return "assistant";
}
