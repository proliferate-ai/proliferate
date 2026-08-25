import type { Session } from "@anyharness/sdk";
import type {
  DesktopRuntimeBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import { resolveRuntimeTargetForWorkspace } from "#product/lib/access/anyharness/runtime-target";
import type { CloudSandboxGatewayUrlSource } from "#product/lib/access/cloud/cloud-sandbox-gateway";
import { resolveStatusFromExecutionSummary } from "#product/domain/sessions/activity";
import {
  findCompatibleExistingSession,
  shouldProbeCompatibleRuntimeSessions,
} from "#product/lib/domain/sessions/creation/compatible-session";
import type { ErrorContext } from "@proliferate/product-client/host/product-host";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import type { SessionRuntimeRecord } from "#product/stores/sessions/session-types";
import {
  assertDirectSessionCreateSupported,
} from "#product/lib/access/anyharness/direct-session-create-guard";
import { DESKTOP_ORIGIN } from "#product/lib/domain/sessions/desktop-origin";
import {
  createSession,
  listWorkspaceSessions,
} from "#product/lib/access/anyharness/sessions";
import { buildLatencyRequestOptions } from "#product/hooks/sessions/workflows/session-creation-request-options";
import {
  materializeExistingSession,
} from "#product/hooks/sessions/workflows/session-creation-materialization-helpers";
import {
  sessionIntentsForSession,
} from "#product/domain/sessions/intents/session-intent-state";
import {
  planCreationConfigIntentSettlement,
  rawConfigValuesFromIntentSnapshot,
  snapshotPreMaterializationConfigIntents,
} from "#product/lib/domain/sessions/creation/config-intent-settlement";
import { filterControlValuesToObservation } from "#product/lib/domain/sessions/creation/launch-control-observation-filter";
import { getAgentLaunchOptions } from "#product/lib/access/anyharness/agents";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import type { CreateSessionWithResolvedConfigOptions } from "#product/hooks/sessions/workflows/session-creation-types";
import { resolveDesktopRuntimeUrlForWorkspace } from "#product/hooks/sessions/workflows/session-creation-runtime";
import { annotateLatencyFlow } from "#product/lib/infra/measurement/measurement-port";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import { publishSessionCreationIfCurrent } from "#product/hooks/sessions/workflows/session-creation-supersession";
import { filterReplacedSessionTombstones } from "#product/hooks/sessions/workflows/session-replacement-tombstones";
import { scheduleCreatedRuntimeSessionCleanup } from "#product/hooks/sessions/workflows/session-created-runtime-cleanup";
import {
  discardCreatedRuntimeSession,
  discardIfSuperseded,
  type MaterializationLifecycle,
} from "#product/hooks/sessions/workflows/session-creation-materialization-interruption";
import {
  publishCreatedSessionMaterialization,
  type TrackChatSessionCreated,
} from "#product/hooks/sessions/workflows/session-creation-publication";

/**
 * Narrow typed telemetry dependencies injected from the calling hook (which
 * reads the product telemetry facade). Keeps this plain workflow free of any
 * vendor import while preserving the exact event name/payload it emits.
 */
type CaptureException = (error: unknown, context?: ErrorContext) => void;

interface MaterializeSessionCreationInput {
  trackProductEvent: TrackChatSessionCreated;
  captureException: CaptureException;
  existingProjectedRecord: SessionRuntimeRecord | null;
  frozenDefaultLiveSessionControlValuesByAgentKind: Record<string, Record<string, string>>;
  localRuntime: DesktopRuntimeBridge | null;
  cloudClient: CloudSandboxGatewayUrlSource | null;
  options: CreateSessionWithResolvedConfigOptions;
  pendingSessionId: string;
  upsertWorkspaceSessionRecord: (
    workspaceId: string,
    session: Session,
  ) => void;
  workspaceId: string;
  onRuntimeSessionCreated?: (session: Session) => Promise<void> | void;
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
  trackProductEvent,
  captureException,
  existingProjectedRecord,
  frozenDefaultLiveSessionControlValuesByAgentKind,
  localRuntime,
  cloudClient,
  options,
  pendingSessionId,
  upsertWorkspaceSessionRecord,
  workspaceId,
  onRuntimeSessionCreated,
}: MaterializeSessionCreationInput, lifecycle: MaterializationLifecycle): Promise<string> {
  const materializeStartedAt = Date.now();
  const requestOptions = buildLatencyRequestOptions(options.latencyFlowId);
  logLatency("session.create.materialize.start", {
    clientSessionId: pendingSessionId,
    workspaceId,
    agentKind: options.agentKind,
    modelId: options.modelId,
  });
  const runtimeUrl = await resolveDesktopRuntimeUrlForWorkspace(workspaceId, localRuntime);
  logLatency("session.create.materialize.runtime_url_resolved", {
    clientSessionId: pendingSessionId,
    workspaceId,
    elapsedMs: Date.now() - materializeStartedAt,
  });

  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
  const target = await resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId, cloudClient);
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
      await publishSessionCreationIfCurrent({
        sessionId: pendingSessionId,
        onSuperseded: () => discardIfSuperseded(pendingSessionId, lifecycle),
        publish: () => {
          materializeExistingSession({
            existingProjectedRecord,
            existingSession,
            fallbackModelId: options.modelId,
            latencyFlowId: options.latencyFlowId,
            pendingSessionId,
            upsertWorkspaceSessionRecord,
            workspaceId,
            launchIntentId: options.launchIntentId,
          });
        },
      });
      return pendingSessionId;
    }
  }

  const subagentsEnabled = options.subagentsEnabled
    ?? useUserPreferencesStore.getState().subagentsEnabled;
  const configIntentSnapshot = snapshotPreMaterializationConfigIntents(
    sessionIntentsForSession(useSessionIntentStore.getState(), pendingSessionId),
  );
  // Run-time refresh of the target's observed launch options: the runtime
  // exact-validates control keys against raw observed ids, so the merged
  // selection (which may carry pre-cutover normalized keys from persisted
  // preferences) is completed from the selected model's defaults and filtered
  // to that exact scope. On fetch failure nothing validatable exists, so send
  // none.
  const launchOptionsObservation = await getAgentLaunchOptions(
    targetConnection,
    options.agentKind,
    requestOptions,
  ).catch(() => null);
  const controlValues = filterControlValuesToObservation({
    ...(frozenDefaultLiveSessionControlValuesByAgentKind[options.agentKind] ?? {}),
    ...(options.launchControlValues ?? {}),
    ...rawConfigValuesFromIntentSnapshot(configIntentSnapshot),
  }, launchOptionsObservation, options.modelId);
  // The options fetch widened the window since the last supersession check;
  // re-check before committing a runtime session.
  if (await discardIfSuperseded(pendingSessionId, lifecycle)) {
    return pendingSessionId;
  }
  assertDirectSessionCreateSupported(target);
  const session: Session = await createSession(targetConnection, {
    ...(options.runtimeSessionId ? { sessionId: options.runtimeSessionId } : {}),
    workspaceId: target.anyharnessWorkspaceId,
    agentKind: options.agentKind,
    modelId: options.modelId,
    controlValues,
    subagentsEnabled,
    origin: DESKTOP_ORIGIN,
  }, requestOptions);
  lifecycle.discardCreatedSession = () => {
    return scheduleCreatedRuntimeSessionCleanup({
      connection: targetConnection,
      workspaceId,
      runtimeSessionId: session.id,
      clientSessionId: pendingSessionId,
      captureException,
    });
  };
  const sessionToRetain = session;
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
      upsertWorkspaceSessionRecord,
      workspaceId,
    });
  };
  await onRuntimeSessionCreated?.(session);
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

  const launchedSession = session;
  const launchedLiveConfig = session.liveConfig ?? null;
  const configIntentSettlement = planCreationConfigIntentSettlement({
    snapshot: configIntentSnapshot,
    liveConfig: launchedLiveConfig,
  });
  if (await discardIfSuperseded(pendingSessionId, lifecycle)) {
    return pendingSessionId;
  }
  const realRecord: SessionRuntimeRecord = {
    ...createEmptySessionRecord(pendingSessionId, options.agentKind, {
      workspaceId,
      materializedSessionId: launchedSession.id,
      modelId: launchedSession.modelId ?? options.modelId,
      requestedModelId: launchedSession.requestedModelId ?? options.modelId,
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

  const published = await publishSessionCreationIfCurrent({
    sessionId: pendingSessionId,
    onSuperseded: () => discardIfSuperseded(pendingSessionId, lifecycle),
    publish: () => {
      publishCreatedSessionMaterialization({
        agentKind: options.agentKind,
        fallbackModelId: options.modelId,
        launchIntentId: options.launchIntentId,
        configIntentSettlement,
        pendingSessionId,
        record: realRecord,
        session: launchedSession,
        trackProductEvent,
        upsertWorkspaceSessionRecord,
        workspaceId,
        workspaceKind: cloudWorkspaceId ? "cloud" : "local",
      });
    },
  });
  if (!published) {
    return pendingSessionId;
  }

  lifecycle.discardCreatedSession = null;
  lifecycle.retainCreatedSession = null;
  return pendingSessionId;
}
