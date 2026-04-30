import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
} from "@anyharness/sdk-react";
import {
  createTranscriptState,
  type ContentPart,
  type PendingPromptEntry,
  streamSession,
} from "@anyharness/sdk";
import type {
  Session,
  SessionEventEnvelope,
  SessionExecutionSummary,
  SessionLiveConfigSnapshot,
  SessionMcpBindingSummary,
  SessionStreamHandle,
} from "@anyharness/sdk";
import {
  resolveSessionViewState,
  resolveStatusFromExecutionSummary,
} from "@/lib/domain/sessions/activity";
import {
  logLatency,
} from "@/lib/infra/debug-latency";
import {
  resolveRuntimeTargetForWorkspace,
  type RuntimeTarget,
} from "@/lib/integrations/anyharness/runtime-target";
import { resolveSessionMcpServersForLaunch } from "@/lib/integrations/anyharness/mcp_launch";
import type { SessionSlot } from "@/stores/sessions/harness-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

type DevSSEEventRecord = {
  sessionId: string;
  receivedAt: string;
  status: "applied" | "duplicate" | "gap";
  envelope: SessionEventEnvelope;
};

interface SessionStreamCallbacks {
  onHandle?: (handle: SessionStreamHandle) => void;
  onOpen: () => void;
  onEvent: (envelope: SessionEventEnvelope) => void;
  onError: () => void;
  onClose: () => void;
}

function buildConnection(baseUrl: string, authToken?: string): AnyHarnessClientConnection {
  return { runtimeUrl: baseUrl, authToken };
}

export function logDevSSEEvent(
  sessionId: string,
  envelope: SessionEventEnvelope,
  status: DevSSEEventRecord["status"],
): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const debugGlobal = globalThis as typeof globalThis & {
    __APOLLO_SSE_EVENTS__?: DevSSEEventRecord[];
  };

  const record: DevSSEEventRecord = {
    sessionId,
    receivedAt: new Date().toISOString(),
    status,
    envelope: sanitizeDevSSEEnvelope(envelope),
  };

  const existing = debugGlobal.__APOLLO_SSE_EVENTS__ ?? [];
  debugGlobal.__APOLLO_SSE_EVENTS__ = [...existing.slice(-499), record];
}

function sanitizeDevSSEEnvelope(envelope: SessionEventEnvelope): SessionEventEnvelope {
  const event = envelope.event;
  if (event.type === "item_started" || event.type === "item_completed") {
    return {
      ...envelope,
      event: {
        ...event,
        item: {
          ...event.item,
          contentParts: sanitizeContentParts(event.item.contentParts ?? []),
          rawInput: undefined,
          rawOutput: undefined,
        },
      },
    };
  }
  if (event.type === "item_delta") {
    return {
      ...envelope,
      event: {
        ...event,
        delta: {
          ...event.delta,
          replaceContentParts: event.delta.replaceContentParts
            ? sanitizeContentParts(event.delta.replaceContentParts)
            : undefined,
          appendContentParts: event.delta.appendContentParts
            ? sanitizeContentParts(event.delta.appendContentParts)
            : undefined,
          rawInput: undefined,
          rawOutput: undefined,
        },
      },
    };
  }
  if (event.type === "pending_prompt_added" || event.type === "pending_prompt_updated") {
    return {
      ...envelope,
      event: {
        ...event,
        text: summarizeSanitizedContent(event.contentParts ?? [], event.text),
        contentParts: sanitizeContentParts(event.contentParts ?? []),
      },
    };
  }
  return envelope;
}

function sanitizeContentParts(parts: ContentPart[]): ContentPart[] {
  return parts.map((part) => {
    switch (part.type) {
      case "text":
        return { type: "text", text: `[text:${part.text.length}]` };
      case "resource":
        return { ...part, preview: part.preview ? `[preview:${part.preview.length}]` : undefined };
      case "tool_input_text":
        return { type: "tool_input_text", text: `[text:${part.text.length}]` };
      case "tool_result_text":
        return { type: "tool_result_text", text: `[text:${part.text.length}]` };
      default:
        return part;
    }
  });
}

function summarizeSanitizedContent(parts: ContentPart[], fallback: string): string {
  return parts.length > 0 ? `[content_parts:${parts.length}]` : `[text:${fallback.length}]`;
}

export function createPendingSessionId(agentKind: string): string {
  return `pending-session:${agentKind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function isPendingSessionId(sessionId: string): boolean {
  return sessionId.startsWith("pending-session:");
}

export function createEmptySessionSlot(
  sessionId: string,
  agentKind: string,
  config?: {
    workspaceId?: string | null;
    modelId?: string | null;
    modeId?: string | null;
    title?: string | null;
    liveConfig?: SessionLiveConfigSnapshot | null;
    executionSummary?: SessionExecutionSummary | null;
    mcpBindingSummaries?: SessionMcpBindingSummary[] | null;
    lastPromptAt?: string | null;
    optimisticPrompt?: PendingPromptEntry | null;
  },
): SessionSlot {
  const resolvedModeId =
    config?.liveConfig?.normalizedControls.mode?.currentValue ?? config?.modeId ?? null;
  const title = config?.title?.trim() || null;
  const transcript = createTranscriptState(sessionId);

  return {
    sessionId,
    workspaceId: config?.workspaceId ?? null,
    agentKind,
    modelId: config?.modelId ?? null,
    modeId: resolvedModeId,
    title,
    liveConfig: config?.liveConfig ?? null,
    executionSummary: config?.executionSummary ?? null,
    mcpBindingSummaries: config?.mcpBindingSummaries ?? null,
    events: [],
    transcript: {
      ...transcript,
      currentModeId: resolvedModeId,
      sessionMeta: {
        ...transcript.sessionMeta,
        title,
      },
    },
    pendingConfigChanges: {},
    optimisticPrompt: config?.optimisticPrompt ?? null,
    status: null,
    lastPromptAt: config?.lastPromptAt ?? null,
    sseHandle: null,
    streamConnectionState: "disconnected",
    transcriptHydrated: false,
  };
}

export function createSessionSlotFromSummary(
  session: Session,
  workspaceId: string,
  options?: {
    titleFallback?: string | null;
    transcriptHydrated?: boolean;
  },
): SessionSlot {
  const modeId =
    session.liveConfig?.normalizedControls.mode?.currentValue
    ?? session.modeId
    ?? null;
  const title = session.title?.trim() || options?.titleFallback?.trim() || null;

  return {
    ...createEmptySessionSlot(session.id, session.agentKind, {
      workspaceId,
      modelId: session.modelId ?? null,
      modeId,
      title,
      liveConfig: session.liveConfig ?? null,
      executionSummary: session.executionSummary ?? null,
      mcpBindingSummaries: session.mcpBindingSummaries ?? null,
      lastPromptAt: session.lastPromptAt ?? null,
    }),
    status: resolveStatusFromExecutionSummary(
      session.executionSummary,
      session.status ?? "idle",
    ),
    transcriptHydrated: options?.transcriptHydrated ?? false,
  };
}

export function getWorkspaceClientAndId(
  runtimeUrl: string,
  workspaceId: string,
): Promise<{ connection: AnyHarnessClientConnection; target: RuntimeTarget }> {
  return resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId).then((target) => ({
    connection: buildConnection(target.baseUrl, target.authToken),
    target,
  }));
}

export async function getSessionClientAndWorkspace(
  sessionId: string,
): Promise<{ connection: AnyHarnessClientConnection; target: RuntimeTarget; workspaceId: string }> {
  const state = useHarnessStore.getState();
  const workspaceId = state.sessionSlots[sessionId]?.workspaceId ?? state.selectedWorkspaceId;
  if (!workspaceId) {
    throw new Error("No workspace selected");
  }

  const { connection, target } = await getWorkspaceClientAndId(state.runtimeUrl, workspaceId);
  return { connection, target, workspaceId };
}

export async function fetchSessionHistory(
  sessionId: string,
  options?: {
    afterSeq?: number;
    requestHeaders?: HeadersInit;
  },
) {
  const { connection } = await getSessionClientAndWorkspace(sessionId);
  const client = getAnyHarnessClient(connection);

  return client.sessions.listEvents(
    sessionId,
    options?.afterSeq != null || options?.requestHeaders
      ? {
        ...(options?.afterSeq != null ? { afterSeq: options.afterSeq } : {}),
        ...(options?.requestHeaders
          ? { request: { headers: options.requestHeaders } }
          : {}),
      }
      : undefined,
  );
}

export async function fetchSessionSummary(
  sessionId: string,
  options?: { requestHeaders?: HeadersInit },
) {
  const { connection } = await getSessionClientAndWorkspace(sessionId);
  return getAnyHarnessClient(connection).sessions.get(
    sessionId,
    options?.requestHeaders ? { headers: options.requestHeaders } : undefined,
  );
}

export async function resumeSession(
  sessionId: string,
  options?: {
    pluginsInCodingSessionsEnabled: boolean;
    requestHeaders?: HeadersInit;
  },
) {
  const { connection, target } = await getSessionClientAndWorkspace(sessionId);
  const client = getAnyHarnessClient(connection);
  const workspace = await client.workspaces.get(
    target.anyharnessWorkspaceId,
    options?.requestHeaders ? { headers: options.requestHeaders } : undefined,
  );
  const isCowork = workspace.surface === "cowork";
  const shouldResolveLaunchMcp = isCowork || options?.pluginsInCodingSessionsEnabled === true;
  const { mcpServers, mcpBindingSummaries } = shouldResolveLaunchMcp
    ? await resolveSessionMcpServersForLaunch({
      targetLocation: target.location,
      workspacePath: workspace.path ?? null,
      policy: {
        workspaceSurface: isCowork ? "cowork" : "coding",
        lifecycle: "resume",
        enabled: shouldResolveLaunchMcp,
      },
    })
    : { mcpServers: [], mcpBindingSummaries: [] };
  return client.sessions.resume(
    sessionId,
    {
      mcpServers,
      mcpBindingSummaries: mcpBindingSummaries.length > 0
        ? mcpBindingSummaries
        : undefined,
    },
    options?.requestHeaders ? { headers: options.requestHeaders } : undefined,
  );
}

export function collectInactiveSessionStreamIds(
  sessionSlots: Record<string, SessionSlot>,
  options?: {
    preserveSessionIds?: Iterable<string>;
  },
): string[] {
  const preservedSessionIds = new Set(options?.preserveSessionIds ?? []);
  const prunableSessionIds: string[] = [];

  for (const [sessionId, slot] of Object.entries(sessionSlots)) {
    if (
      !slot.sseHandle
      || isPendingSessionId(sessionId)
      || preservedSessionIds.has(sessionId)
    ) {
      continue;
    }

    const viewState = resolveSessionViewState(slot);
    if (viewState === "working" || viewState === "needs_input") {
      continue;
    }

    prunableSessionIds.push(sessionId);
  }

  return prunableSessionIds;
}

export function pruneInactiveSessionStreams(
  options?: {
    preserveSessionIds?: Iterable<string>;
  },
): string[] {
  const state = useHarnessStore.getState();
  const prunableSessionIds = collectInactiveSessionStreamIds(
    state.sessionSlots,
    options,
  );
  if (prunableSessionIds.length === 0) {
    return [];
  }

  const nextSlots = { ...state.sessionSlots };
  for (const sessionId of prunableSessionIds) {
    const slot = nextSlots[sessionId];
    if (!slot?.sseHandle) {
      continue;
    }
    slot.sseHandle.close();
    nextSlots[sessionId] = {
      ...slot,
      sseHandle: null,
      streamConnectionState: "disconnected",
    };
  }

  useHarnessStore.setState({ sessionSlots: nextSlots });
  logLatency("session.stream.pruned", {
    closedSessionCount: prunableSessionIds.length,
  });
  return prunableSessionIds;
}

export async function openSessionStream(
  sessionId: string,
  options: {
    afterSeq?: number;
    requestHeaders?: HeadersInit;
  } & SessionStreamCallbacks,
): Promise<SessionStreamHandle> {
  const { connection } = await getSessionClientAndWorkspace(sessionId);

  const handle = streamSession({
    baseUrl: connection.runtimeUrl,
    authToken: connection.authToken ?? undefined,
    headers: options.requestHeaders,
    sessionId,
    afterSeq: options.afterSeq ?? 0,
    onOpen: options.onOpen,
    onEvent: options.onEvent,
    onError: options.onError,
    onClose: options.onClose,
  }) as SessionStreamHandle;

  options.onHandle?.(handle);
  return handle;
}
