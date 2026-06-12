import type { Session } from "@anyharness/sdk";
import { applySessionLaunchDefaults } from "@/lib/workflows/sessions/session-launch-defaults";
import { createSessionLaunchDefaultsClient } from "@/lib/access/anyharness/session-launch-defaults-client";
import {
  resolveRuntimeTargetForWorkspace,
} from "@/lib/access/anyharness/runtime-target";
import { resolveStatusFromExecutionSummary } from "@proliferate/product-domain/sessions/activity";
import {
  findCompatibleExistingSession,
  shouldProbeCompatibleRuntimeSessions,
} from "@/lib/domain/sessions/creation/compatible-session";
import {
  mergeLiveDefaultLaunchControls,
} from "@/lib/domain/sessions/creation/launch-controls";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import {
  pendingConfigChangesForSessionIntents,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import {
  sessionIntentsForSession,
} from "@proliferate/product-domain/sessions/intents/session-intent-state";
import {
  assertDirectSessionCreateRuntimeConfigStamped,
  prepareLocalSessionRuntimeConfig,
} from "@/lib/access/anyharness/session-runtime-config";
import { DESKTOP_ORIGIN } from "@/lib/domain/sessions/desktop-origin";
import {
  createSession,
  getSession,
  listWorkspaceSessions,
} from "@/lib/access/anyharness/sessions";
import { rememberLastViewedSession } from "@/stores/preferences/workspace-ui-store";
import { buildLatencyRequestOptions } from "@/hooks/sessions/workflows/session-creation-request-options";
import {
  materializeSessionRecord,
} from "@/hooks/sessions/workflows/session-creation-local-state";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { buildDesktopLaunchModelRegistries } from "@/lib/domain/agents/cloud-launch-catalog";
import { startCloudSessionCommandResult } from "@/lib/access/cloud/session-commands";
import type { CreateSessionWithResolvedConfigOptions } from "@/hooks/sessions/workflows/session-creation-types";
import { resolveDesktopRuntimeUrlForWorkspace } from "@/hooks/sessions/workflows/session-creation-runtime";
import { annotateLatencyFlow } from "@/lib/infra/measurement/latency-flow";
import { logLatency } from "@/lib/infra/measurement/debug-latency";

interface MaterializeSessionCreationInput {
  ensureCloudAgentCatalog: () => Promise<{
    agents: Parameters<typeof buildDesktopLaunchModelRegistries>[0];
  }>;
  existingProjectedRecord: SessionRuntimeRecord | null;
  frozenDefaultLiveSessionControlValuesByAgentKind: Record<string, Record<string, string>>;
  options: CreateSessionWithResolvedConfigOptions;
  pendingSessionId: string;
  resolvedModeId: string | null;
  upsertWorkspaceSessionRecord: (workspaceId: string, session: Session) => void;
  workspaceId: string;
}

export async function materializeSessionCreation({
  ensureCloudAgentCatalog,
  existingProjectedRecord,
  frozenDefaultLiveSessionControlValuesByAgentKind,
  options,
  pendingSessionId,
  resolvedModeId,
  upsertWorkspaceSessionRecord,
  workspaceId,
}: MaterializeSessionCreationInput): Promise<string> {
  const materializeStartedAt = Date.now();
  const requestOptions = buildLatencyRequestOptions(options.latencyFlowId);
  logLatency("session.create.materialize.start", {
    clientSessionId: pendingSessionId,
    workspaceId,
    agentKind: options.agentKind,
    modelId: options.modelId,
    modeId: resolvedModeId,
  });
  const runtimeUrl = await resolveDesktopRuntimeUrlForWorkspace(workspaceId);
  logLatency("session.create.materialize.runtime_url_resolved", {
    clientSessionId: pendingSessionId,
    workspaceId,
    elapsedMs: Date.now() - materializeStartedAt,
  });

  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
  const target = await resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId);
  logLatency("session.create.materialize.target_resolved", {
    clientSessionId: pendingSessionId,
    workspaceId,
    targetLocation: target.location,
    runtimeGeneration: target.runtimeGeneration,
    hasCloudWorkspaceId: Boolean(target.cloudWorkspaceId),
    hasTargetId: Boolean(target.targetId),
    elapsedMs: Date.now() - materializeStartedAt,
  });
  const targetConnection = {
    runtimeUrl: target.baseUrl,
    authToken: target.authToken,
  };
  const workspaceConnection = {
    ...targetConnection,
    anyharnessWorkspaceId: target.anyharnessWorkspaceId,
  };
  if (shouldProbeCompatibleRuntimeSessions({
    preferExistingCompatibleSession: options.preferExistingCompatibleSession,
    runtimeLocation: target.location,
  })) {
    const existingSession = await listWorkspaceSessions(
      workspaceConnection,
      requestOptions,
    )
      .then((sessions) => findCompatibleExistingSession({
        sessions,
        agentKind: options.agentKind,
        modelId: options.modelId,
      }))
      .catch(() => null);
    if (existingSession) {
      return materializeExistingSession({
        existingProjectedRecord,
        existingSession,
        fallbackModelId: options.modelId,
        latencyFlowId: options.latencyFlowId,
        pendingSessionId,
        resolvedModeId,
        upsertWorkspaceSessionRecord,
        workspaceId,
        launchIntentId: options.launchIntentId,
      });
    }
  }

  const subagentsEnabled = useUserPreferencesStore.getState().subagentsEnabled;
  let session: Session;
  if (target.location === "cloud") {
    if (!target.cloudWorkspaceId || !target.targetId) {
      throw new Error("Cloud workspace is missing command routing metadata.");
    }
    const startResult = await startCloudSessionCommandResult({
      idempotencyKey: `desktop:start-session:${target.cloudWorkspaceId}:${pendingSessionId}`,
      targetId: target.targetId,
      cloudWorkspaceId: target.cloudWorkspaceId,
      anyharnessWorkspaceId: target.anyharnessWorkspaceId,
      agentKind: options.agentKind,
      modelId: options.modelId,
      modeId: resolvedModeId,
      subagentsEnabled,
    });
    session = startResult.session
      ?? await getSession(targetConnection, startResult.sessionId, requestOptions);
  } else {
    assertDirectSessionCreateRuntimeConfigStamped(target);
    const expectedRuntimeConfigRevision = await prepareLocalSessionRuntimeConfig(
      targetConnection,
      requestOptions,
    );
    logLatency("session.create.materialize.runtime_config_prepared", {
      clientSessionId: pendingSessionId,
      workspaceId,
      hasExpectedRuntimeConfigRevision: Boolean(expectedRuntimeConfigRevision),
      elapsedMs: Date.now() - materializeStartedAt,
    });
    session = await createSession(targetConnection, {
      workspaceId: target.anyharnessWorkspaceId,
      agentKind: options.agentKind,
      modelId: options.modelId,
      ...(resolvedModeId ? { modeId: resolvedModeId } : {}),
      ...(expectedRuntimeConfigRevision ? { expectedRuntimeConfigRevision } : {}),
      subagentsEnabled,
      origin: DESKTOP_ORIGIN,
    }, requestOptions);
  }
  logLatency("session.create.materialize.session_created", {
    clientSessionId: pendingSessionId,
    materializedSessionId: session.id,
    workspaceId,
    agentKind: options.agentKind,
    modelId: session.modelId ?? options.modelId,
    elapsedMs: Date.now() - materializeStartedAt,
  });

  annotateLatencyFlow(options.latencyFlowId, {
    targetSessionId: session.id,
  });

  const queuedConfigValuesBeforeDefaults = pendingConfigValuesForSession(pendingSessionId);
  const cloudLaunchCatalog = await ensureCloudAgentCatalog().catch(() => null);
  const modelRegistries = buildDesktopLaunchModelRegistries(
    cloudLaunchCatalog?.agents ?? [],
  );
  const liveDefaultsForLaunch = mergeLiveDefaultLaunchControls({
    defaults: frozenDefaultLiveSessionControlValuesByAgentKind,
    agentKind: options.agentKind,
    values: queuedConfigValuesBeforeDefaults,
  });
  const launchDefaults = await applySessionLaunchDefaults({
    client: createSessionLaunchDefaultsClient(targetConnection),
    session,
    agentKind: options.agentKind,
    modelRegistries,
    defaultLiveSessionControlValuesByAgentKind: liveDefaultsForLaunch,
  });
  const launchedSession = launchDefaults.session;
  const launchedLiveConfig = launchDefaults.liveConfig
    ?? launchedSession.liveConfig
    ?? null;
  const realRecord: SessionRuntimeRecord = {
    ...createEmptySessionRecord(pendingSessionId, options.agentKind, {
      workspaceId,
      materializedSessionId: launchedSession.id,
      modelId: launchedSession.modelId ?? options.modelId,
      requestedModelId: launchedSession.requestedModelId ?? options.modelId,
      modeId: launchedSession.modeId ?? resolvedModeId,
      title: launchedSession.title ?? existingProjectedRecord?.title ?? null,
      actionCapabilities: launchedSession.actionCapabilities,
      liveConfig: launchedLiveConfig,
      executionSummary: launchedSession.executionSummary ?? null,
      mcpBindingSummaries: launchedSession.mcpBindingSummaries ?? null,
      lastPromptAt: launchedSession.lastPromptAt ?? null,
      hasAttemptedPrompt: getSessionRecord(pendingSessionId)?.hasAttemptedPrompt ?? false,
      optimisticPrompt: null,
      pendingConfigChanges: {},
      sessionRelationship: { kind: "root" },
    }),
    status: resolveStatusFromExecutionSummary(
      launchedSession.executionSummary,
      launchedSession.status ?? "idle",
    ),
    transcriptHydrated: true,
  };

  materializeSessionRecord(pendingSessionId, launchedSession.id, realRecord);
  useSessionIntentStore.getState().bindMaterializedSession(
    pendingSessionId,
    launchedSession.id,
  );
  logLatency("session.create.materialized", {
    clientSessionId: pendingSessionId,
    materializedSessionId: launchedSession.id,
    workspaceId,
    agentKind: options.agentKind,
    modelId: launchedSession.modelId ?? options.modelId,
    modeId: launchedSession.modeId ?? resolvedModeId,
    status: realRecord.status,
    executionPhase: launchedSession.executionSummary?.phase ?? null,
    pendingInteractionCount: launchedSession.executionSummary?.pendingInteractions?.length ?? 0,
    activeSessionId: useSessionSelectionStore.getState().activeSessionId,
  });
  if (useSessionSelectionStore.getState().activeSessionId === pendingSessionId) {
    rememberLastViewedSession(workspaceId, launchedSession.id);
  }
  upsertWorkspaceSessionRecord(workspaceId, launchedSession);
  trackProductEvent("chat_session_created", {
    workspace_kind: cloudWorkspaceId ? "cloud" : "local",
    agent_kind: options.agentKind,
  });

  if (options.launchIntentId) {
    useChatLaunchIntentStore.getState().markMaterializedIfActive(
      options.launchIntentId,
      {
        clientSessionId: pendingSessionId,
        workspaceId,
        sessionId: launchedSession.id,
      },
    );
  }

  return pendingSessionId;
}

function materializeExistingSession({
  existingProjectedRecord,
  existingSession,
  fallbackModelId,
  latencyFlowId,
  launchIntentId,
  pendingSessionId,
  resolvedModeId,
  upsertWorkspaceSessionRecord,
  workspaceId,
}: {
  existingProjectedRecord: SessionRuntimeRecord | null;
  existingSession: Session;
  fallbackModelId: string;
  latencyFlowId?: string | null;
  launchIntentId?: string | null;
  pendingSessionId: string;
  resolvedModeId: string | null;
  upsertWorkspaceSessionRecord: (workspaceId: string, session: Session) => void;
  workspaceId: string;
}): string {
  annotateLatencyFlow(latencyFlowId, {
    targetSessionId: existingSession.id,
  });
  const realRecord = materializedRecordFromExistingSession({
    clientSessionId: pendingSessionId,
    session: existingSession,
    workspaceId,
    fallbackModelId,
    fallbackModeId: resolvedModeId,
    fallbackTitle: existingProjectedRecord?.title ?? null,
    pendingConfigChanges: {},
  });
  materializeSessionRecord(pendingSessionId, existingSession.id, realRecord);
  useSessionIntentStore.getState().bindMaterializedSession(
    pendingSessionId,
    existingSession.id,
  );
  if (useSessionSelectionStore.getState().activeSessionId === pendingSessionId) {
    rememberLastViewedSession(workspaceId, existingSession.id);
  }
  upsertWorkspaceSessionRecord(workspaceId, existingSession);
  if (launchIntentId) {
    useChatLaunchIntentStore.getState().markMaterializedIfActive(
      launchIntentId,
      {
        clientSessionId: pendingSessionId,
        workspaceId,
        sessionId: existingSession.id,
      },
    );
  }
  return pendingSessionId;
}

function pendingConfigValuesForSession(sessionId: string): Record<string, string> {
  const pendingConfigChanges = pendingConfigChangesForSessionIntents(
    sessionIntentsForSession(useSessionIntentStore.getState(), sessionId),
  );
  return Object.fromEntries(
    Object.values(pendingConfigChanges)
      .map((change) => [change.rawConfigId, change.value] as const),
  );
}

function materializedRecordFromExistingSession({
  clientSessionId,
  session,
  workspaceId,
  fallbackModelId,
  fallbackModeId,
  fallbackTitle,
  pendingConfigChanges,
}: {
  clientSessionId: string;
  session: Session;
  workspaceId: string;
  fallbackModelId: string;
  fallbackModeId: string | null;
  fallbackTitle: string | null;
  pendingConfigChanges: SessionRuntimeRecord["pendingConfigChanges"];
}): SessionRuntimeRecord {
  return {
    ...createEmptySessionRecord(clientSessionId, session.agentKind, {
      workspaceId,
      materializedSessionId: session.id,
      modelId: session.modelId ?? fallbackModelId,
      requestedModelId: session.requestedModelId ?? fallbackModelId,
      modeId: session.modeId ?? fallbackModeId,
      title: session.title ?? fallbackTitle,
      actionCapabilities: session.actionCapabilities,
      liveConfig: session.liveConfig ?? null,
      executionSummary: session.executionSummary ?? null,
      mcpBindingSummaries: session.mcpBindingSummaries ?? null,
      lastPromptAt: session.lastPromptAt ?? null,
      hasAttemptedPrompt: getSessionRecord(clientSessionId)?.hasAttemptedPrompt ?? false,
      optimisticPrompt: null,
      pendingConfigChanges,
      sessionRelationship: { kind: "root" },
    }),
    status: resolveStatusFromExecutionSummary(
      session.executionSummary,
      session.status ?? "idle",
    ),
    transcriptHydrated: true,
  };
}
