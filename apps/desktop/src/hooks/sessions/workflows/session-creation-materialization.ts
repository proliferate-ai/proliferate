import type { Session } from "@anyharness/sdk";
import type { DesktopRuntimeBridge } from "@proliferate/product-client/host/desktop-bridge";
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
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import {
  assertDirectSessionCreateSupported,
} from "@/lib/access/anyharness/direct-session-create-guard";
import { DESKTOP_ORIGIN } from "@/lib/domain/sessions/desktop-origin";
import {
  createSession,
  listWorkspaceSessions,
} from "@/lib/access/anyharness/sessions";
import { rememberLastViewedSession } from "@/stores/preferences/workspace-ui-store";
import { buildLatencyRequestOptions } from "@/hooks/sessions/workflows/session-creation-request-options";
import {
  materializeSessionRecord,
} from "@/hooks/sessions/workflows/session-creation-local-state";
import {
  materializeExistingSession,
  pendingConfigValuesForSession,
  requeuePromptIntentsBlockedOnMaterialization,
} from "@/hooks/sessions/workflows/session-creation-materialization-helpers";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { buildDesktopLaunchModelRegistries } from "@/lib/domain/agents/cloud-launch-catalog";
import type { CreateSessionWithResolvedConfigOptions } from "@/hooks/sessions/workflows/session-creation-types";
import { resolveDesktopRuntimeUrlForWorkspace } from "@/hooks/sessions/workflows/session-creation-runtime";
import { annotateLatencyFlow } from "@/lib/infra/measurement/latency-flow";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  shouldDiscardSupersededSessionCreation,
} from "@/hooks/sessions/workflows/session-creation-supersession";
import { filterReplacedSessionTombstones } from "@/hooks/sessions/workflows/session-replacement-tombstones";
import { scheduleCreatedRuntimeSessionCleanup } from "@/hooks/sessions/workflows/session-created-runtime-cleanup";
import { runInterruptibleSessionCreationStep } from "@/hooks/sessions/workflows/session-creation-materialization-interruption";

interface MaterializeSessionCreationInput {
  ensureCloudAgentCatalog: () => Promise<{
    agents: Parameters<typeof buildDesktopLaunchModelRegistries>[0];
  }>;
  existingProjectedRecord: SessionRuntimeRecord | null;
  frozenDefaultLiveSessionControlValuesByAgentKind: Record<string, Record<string, string>>;
  localRuntime: DesktopRuntimeBridge | null;
  options: CreateSessionWithResolvedConfigOptions;
  pendingSessionId: string;
  resolvedModeId: string | null;
  upsertWorkspaceSessionRecord: (
    workspaceId: string,
    session: Session,
  ) => void;
  workspaceId: string;
}

interface MaterializationLifecycle {
  discardCreatedSession: (() => Promise<boolean>) | null;
  retainCreatedSession: (() => void) | null;
}

export async function materializeSessionCreation(
  input: MaterializeSessionCreationInput,
): Promise<string> {
  const lifecycle: MaterializationLifecycle = {
    discardCreatedSession: null,
    retainCreatedSession: null,
  };
  try {
    return await runSessionCreationMaterialization(input, lifecycle);
  } catch (error) {
    if (await discardIfSuperseded(input.pendingSessionId, lifecycle)) {
      return input.pendingSessionId;
    }
    if (!await discardCreatedRuntimeSession(lifecycle)) {
      return input.pendingSessionId;
    }
    throw error;
  }
}

async function runSessionCreationMaterialization({
  ensureCloudAgentCatalog,
  existingProjectedRecord,
  frozenDefaultLiveSessionControlValuesByAgentKind,
  localRuntime,
  options,
  pendingSessionId,
  resolvedModeId,
  upsertWorkspaceSessionRecord,
  workspaceId,
}: MaterializeSessionCreationInput, lifecycle: MaterializationLifecycle): Promise<string> {
  const materializeStartedAt = Date.now();
  const requestOptions = buildLatencyRequestOptions(options.latencyFlowId);
  logLatency("session.create.materialize.start", {
    clientSessionId: pendingSessionId,
    workspaceId,
    agentKind: options.agentKind,
    modelId: options.modelId,
    modeId: resolvedModeId,
  });
  const runtimeUrl = await resolveDesktopRuntimeUrlForWorkspace(workspaceId, localRuntime);
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
  if (await discardIfSuperseded(pendingSessionId, lifecycle)) {
    return pendingSessionId;
  }
  if (shouldProbeCompatibleRuntimeSessions({
    preferExistingCompatibleSession: options.preferExistingCompatibleSession,
    runtimeLocation: target.location,
  })) {
    const existingSession = await listWorkspaceSessions(
      workspaceConnection,
      requestOptions,
    )
      .then((sessions) => findCompatibleExistingSession({
        sessions: filterReplacedSessionTombstones(workspaceId, sessions) ?? [],
        agentKind: options.agentKind,
        modelId: options.modelId,
      }))
      .catch(() => null);
    if (existingSession) {
      if (await discardIfSuperseded(pendingSessionId, lifecycle)) {
        return pendingSessionId;
      }
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
  assertDirectSessionCreateSupported(target);
  const session: Session = await createSession(targetConnection, {
    workspaceId: target.anyharnessWorkspaceId,
    agentKind: options.agentKind,
    modelId: options.modelId,
    ...(resolvedModeId ? { modeId: resolvedModeId } : {}),
    subagentsEnabled,
    origin: DESKTOP_ORIGIN,
  }, requestOptions);
  lifecycle.discardCreatedSession = () => {
    return scheduleCreatedRuntimeSessionCleanup({
      connection: targetConnection,
      workspaceId,
      runtimeSessionId: session.id,
      clientSessionId: pendingSessionId,
    });
  };
  let sessionToRetain = session;
  lifecycle.retainCreatedSession = () => {
    if (!getSessionRecord(pendingSessionId)) {
      putSessionRecord(createEmptySessionRecord(
        pendingSessionId,
        sessionToRetain.agentKind,
        {
          workspaceId,
          materializedSessionId: null,
          modelId: sessionToRetain.modelId ?? options.modelId,
          requestedModelId: sessionToRetain.requestedModelId ?? options.modelId,
          modeId: sessionToRetain.modeId ?? resolvedModeId,
          title: sessionToRetain.title ?? existingProjectedRecord?.title ?? null,
          sessionRelationship: { kind: "root" },
        },
      ));
    }
    materializeExistingSession({
      existingProjectedRecord,
      existingSession: sessionToRetain,
      fallbackModelId: options.modelId,
      latencyFlowId: options.latencyFlowId,
      launchIntentId: options.launchIntentId,
      pendingSessionId,
      resolvedModeId,
      upsertWorkspaceSessionRecord,
      workspaceId,
    });
  };
  if (await discardIfSuperseded(pendingSessionId, lifecycle)) {
    return pendingSessionId;
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
  const catalogStep = await runInterruptibleSessionCreationStep({
    sessionId: pendingSessionId,
    step: ensureCloudAgentCatalog().catch(() => null),
    onSuperseded: () => discardIfSuperseded(pendingSessionId, lifecycle),
  });
  if (catalogStep.discarded) {
    return pendingSessionId;
  }
  const cloudLaunchCatalog = catalogStep.value;
  const modelRegistries = buildDesktopLaunchModelRegistries(
    cloudLaunchCatalog?.agents ?? [],
  );
  const liveDefaultsForLaunch = mergeLiveDefaultLaunchControls({
    defaults: frozenDefaultLiveSessionControlValuesByAgentKind,
    agentKind: options.agentKind,
    values: queuedConfigValuesBeforeDefaults,
  });
  const launchDefaultsStep = await runInterruptibleSessionCreationStep({
    sessionId: pendingSessionId,
    step: applySessionLaunchDefaults({
      client: createSessionLaunchDefaultsClient(targetConnection),
      session,
      agentKind: options.agentKind,
      modelRegistries,
      defaultLiveSessionControlValuesByAgentKind: liveDefaultsForLaunch,
    }),
    onSuperseded: () => discardIfSuperseded(pendingSessionId, lifecycle),
  });
  if (launchDefaultsStep.discarded) {
    return pendingSessionId;
  }
  const launchDefaults = launchDefaultsStep.value;
  const launchedSession = launchDefaults.session;
  const launchedLiveConfig = launchDefaults.liveConfig
    ?? launchedSession.liveConfig
    ?? null;
  sessionToRetain = {
    ...launchedSession,
    liveConfig: launchedLiveConfig,
  };
  if (await discardIfSuperseded(pendingSessionId, lifecycle)) {
    return pendingSessionId;
  }
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
  requeuePromptIntentsBlockedOnMaterialization({
    clientSessionId: pendingSessionId,
    materializedSessionId: launchedSession.id,
    workspaceId,
  });
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

  lifecycle.discardCreatedSession = null;
  lifecycle.retainCreatedSession = null;
  return pendingSessionId;
}

async function discardIfSuperseded(
  sessionId: string,
  lifecycle: MaterializationLifecycle,
): Promise<boolean> {
  if (!await shouldDiscardSupersededSessionCreation(sessionId)) {
    return false;
  }
  const discardCreatedSession = lifecycle.discardCreatedSession;
  lifecycle.discardCreatedSession = null;
  if (!discardCreatedSession || await discardCreatedSession()) {
    lifecycle.retainCreatedSession = null;
    return true;
  }
  // The successor already committed, but this created runtime could not be
  // retired safely. Publish it honestly and stop this older materializer here.
  const retainCreatedSession = lifecycle.retainCreatedSession;
  lifecycle.retainCreatedSession = null;
  retainCreatedSession?.();
  return true;
}

async function discardCreatedRuntimeSession(
  lifecycle: MaterializationLifecycle,
): Promise<boolean> {
  const discardCreatedSession = lifecycle.discardCreatedSession;
  lifecycle.discardCreatedSession = null;
  if (!discardCreatedSession || await discardCreatedSession()) {
    lifecycle.retainCreatedSession = null;
    return true;
  }
  const retainCreatedSession = lifecycle.retainCreatedSession;
  lifecycle.retainCreatedSession = null;
  retainCreatedSession?.();
  return false;
}
