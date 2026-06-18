import {
  getPendingSessionConfigChange,
  reconcilePendingConfigChanges,
  type PendingSessionConfigChanges,
} from "@proliferate/product-domain/sessions/pending-config";
import {
  pendingConfigChangesForSessionIntents,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import type {
  SessionUpdateConfigIntent,
} from "@proliferate/product-domain/sessions/intents/session-intent-model";
import { sessionIntentsForSession } from "@proliferate/product-domain/sessions/intents/session-intent-state";
import type { SessionEventEnvelope, SessionLiveConfigSnapshot, TranscriptState } from "@anyharness/sdk";
import { useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { resolveCurrentModeLabel } from "@/lib/domain/chat/composer/chat-input";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useActiveSessionId } from "./use-active-session-identity";

const EMPTY_CONFIG_INTENTS: readonly SessionUpdateConfigIntent[] = [];

type NormalizedSessionControls = NonNullable<TranscriptState["liveConfig"]>["normalizedControls"];
type NormalizedSessionModelControl = NormalizedSessionControls["model"];

interface LatestSessionStateUpdate {
  modelId: string | null;
  requestedModelId: string | null;
  hasModelId: boolean;
  hasRequestedModelId: boolean;
}

export interface ActiveLaunchIdentity {
  kind: string;
  modelId: string;
}

export function useActiveSessionLaunchState(): {
  activeSessionId: string | null;
  currentLaunchIdentity: ActiveLaunchIdentity | null;
  currentModelConfigId: string | null;
  pendingConfigChanges: PendingSessionConfigChanges | null;
  modelId: string | null;
  agentKind: string | null;
  modelControl: NonNullable<TranscriptState["liveConfig"]>["normalizedControls"]["model"] | null;
} {
  const activeSessionId = useActiveSessionId();
  const configIntents = useSessionIntentStore(useShallow((state) =>
    activeSessionId ? configIntentsForSession(state, activeSessionId) : EMPTY_CONFIG_INTENTS
  ));
  const intentPendingConfigChanges = useMemo(
    () => pendingConfigChangesForSessionIntents(configIntents),
    [configIntents],
  );
  const slice = useSessionDirectoryStore(useShallow((state) => {
    const entry = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
    const modelControl = entry?.liveConfig?.normalizedControls.model ?? null;
    return {
      activeSessionId,
      agentKind: entry?.agentKind ?? null,
      modelId: entry?.modelId ?? null,
      requestedModelId: entry?.requestedModelId ?? null,
      liveConfig: entry?.liveConfig ?? null,
      directoryPendingConfigChanges: normalizeEmptyPendingConfigChanges(
        entry?.pendingConfigChanges,
      ),
      currentModelConfigId: modelControl?.rawConfigId ?? null,
      modelControl,
    };
  }));
  const latestSessionStateUpdate = useSessionTranscriptStore(useShallow((state) =>
    latestSessionStateUpdateFromEvents(
      activeSessionId
        ? state.entriesById[activeSessionId]?.events ?? null
        : null,
    )
  ));
  const stableModelControl = useStableModelControl(slice.modelControl);
  const pendingConfigChanges = useMemo(
    () => composePendingConfigChanges(
      slice.liveConfig,
      slice.directoryPendingConfigChanges,
      intentPendingConfigChanges,
    ),
    [intentPendingConfigChanges, slice.directoryPendingConfigChanges, slice.liveConfig],
  );

  const pendingModelId = useMemo(() => {
    if (!slice.currentModelConfigId) {
      return null;
    }
    return getPendingSessionConfigChange(
      pendingConfigChanges,
      slice.currentModelConfigId,
    )?.value ?? null;
  }, [pendingConfigChanges, slice.currentModelConfigId]);

  const currentLaunchIdentity = useMemo<ActiveLaunchIdentity | null>(() => {
    if (!slice.agentKind) {
      return null;
    }
    const effectiveModelId = latestSessionStateUpdate.hasModelId
      ? latestSessionStateUpdate.modelId
      : slice.modelId;
    const effectiveRequestedModelId = latestSessionStateUpdate.hasRequestedModelId
      ? latestSessionStateUpdate.requestedModelId
      : slice.requestedModelId;
    const modelId =
      pendingModelId
      ?? slice.modelControl?.currentValue
      ?? resolveActiveSessionLaunchModelId(
        slice.agentKind,
        effectiveModelId,
        effectiveRequestedModelId,
      )
      ?? null;
    return modelId ? { kind: slice.agentKind, modelId } : null;
  }, [
    latestSessionStateUpdate.hasModelId,
    latestSessionStateUpdate.hasRequestedModelId,
    latestSessionStateUpdate.modelId,
    latestSessionStateUpdate.requestedModelId,
    pendingModelId,
    slice.agentKind,
    slice.modelControl?.currentValue,
    slice.modelId,
    slice.requestedModelId,
  ]);

  return {
    ...slice,
    modelId: latestSessionStateUpdate.hasModelId
      ? latestSessionStateUpdate.modelId
      : slice.modelId,
    modelControl: stableModelControl,
    currentLaunchIdentity,
    pendingConfigChanges,
  };
}

export function useActiveSessionConfigState() {
  const activeSessionId = useActiveSessionId();
  const configIntents = useSessionIntentStore(useShallow((state) =>
    activeSessionId ? configIntentsForSession(state, activeSessionId) : EMPTY_CONFIG_INTENTS
  ));
  const intentPendingConfigChanges = useMemo(
    () => pendingConfigChangesForSessionIntents(configIntents),
    [configIntents],
  );
  const slice = useSessionDirectoryStore(useShallow((state) => {
    const entry = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
    return {
      agentKind: entry?.agentKind ?? null,
      materializedSessionId: entry?.materializedSessionId ?? null,
      modeId: entry?.modeId ?? null,
      workspaceId: entry?.workspaceId ?? null,
      liveConfig: entry?.liveConfig ?? null,
      normalizedControls: entry?.liveConfig?.normalizedControls ?? null,
      directoryPendingConfigChanges: normalizeEmptyPendingConfigChanges(
        entry?.pendingConfigChanges,
      ),
    };
  }));
  const stableNormalizedControls = useStableNormalizedControls(slice.normalizedControls);
  const pendingConfigChanges = useMemo(
    () => composePendingConfigChanges(
      slice.liveConfig,
      slice.directoryPendingConfigChanges,
      intentPendingConfigChanges,
    ),
    [intentPendingConfigChanges, slice.directoryPendingConfigChanges, slice.liveConfig],
  );
  return {
    ...slice,
    normalizedControls: stableNormalizedControls,
    pendingConfigChanges,
  };
}

export function useActiveSessionModeState(): {
  currentModeId: string | null;
  currentModeLabel: string | null;
} {
  const activeSessionId = useActiveSessionId();
  const directory = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId] ?? null : null
  );
  return useSessionTranscriptStore(useShallow((state) => {
    const transcript = activeSessionId ? state.entriesById[activeSessionId]?.transcript ?? null : null;
    return {
      currentModeId: transcript?.currentModeId ?? directory?.modeId ?? null,
      currentModeLabel: resolveCurrentModeLabel(directory
        ? {
          modeId: directory.modeId,
          transcript,
          liveConfig: directory.liveConfig,
        }
        : null),
    };
  }));
}

// Drop an optimistic intent change once the authoritative live config already
// reflects its value. No-op switches (NoChange / already-current) match
// immediately and release at once — important because the backend emits no
// config_option_update for them, so there is no later event to clear them and
// they would otherwise stay optimistically stuck. A real switch keeps its
// optimistic value until the authoritative currentValue catches up. Scoped to
// intent-pending only; server-side queued changes keep their own pending state.
function releaseOptimisticIntentChanges(
  liveConfig: SessionLiveConfigSnapshot | null | undefined,
  intentPendingConfigChanges: PendingSessionConfigChanges,
): PendingSessionConfigChanges {
  return reconcilePendingConfigChanges(liveConfig, intentPendingConfigChanges)
    .pendingConfigChanges;
}

/**
 * The displayed pending-config map: optimistic intent changes (released once the
 * authoritative live config reflects them) merged over server-side directory
 * changes. Directory changes are intentionally NOT reconciled here — they keep
 * their own pending state and reconcile at stream-flush. Exported for unit tests.
 */
export function composePendingConfigChanges(
  liveConfig: SessionLiveConfigSnapshot | null | undefined,
  directoryPendingConfigChanges: PendingSessionConfigChanges | null | undefined,
  intentPendingConfigChanges: PendingSessionConfigChanges,
): PendingSessionConfigChanges | null {
  return mergePendingConfigChanges(
    directoryPendingConfigChanges,
    releaseOptimisticIntentChanges(liveConfig, intentPendingConfigChanges),
  );
}

function mergePendingConfigChanges(
  directoryPendingConfigChanges: PendingSessionConfigChanges | null | undefined,
  intentPendingConfigChanges: PendingSessionConfigChanges,
): PendingSessionConfigChanges | null {
  const hasDirectoryChanges = directoryPendingConfigChanges
    ? Object.keys(directoryPendingConfigChanges).length > 0
    : false;
  const hasIntentChanges = Object.keys(intentPendingConfigChanges).length > 0;
  if (!hasDirectoryChanges && !hasIntentChanges) {
    return null;
  }
  if (!hasDirectoryChanges) {
    return intentPendingConfigChanges;
  }
  if (!hasIntentChanges) {
    return directoryPendingConfigChanges ?? null;
  }
  return {
    ...directoryPendingConfigChanges,
    ...intentPendingConfigChanges,
  };
}

function normalizeEmptyPendingConfigChanges(
  changes: PendingSessionConfigChanges | null | undefined,
): PendingSessionConfigChanges | null {
  return changes && Object.keys(changes).length > 0 ? changes : null;
}

function useStableModelControl(
  control: NormalizedSessionModelControl | null,
): NormalizedSessionModelControl | null {
  return useStableBySignature(control, modelControlSignature);
}

function useStableNormalizedControls(
  controls: NormalizedSessionControls | null,
): NormalizedSessionControls | null {
  return useStableBySignature(controls, normalizedControlsSignature);
}

function useStableBySignature<T>(
  value: T | null,
  buildSignature: (value: T | null) => string,
): T | null {
  const ref = useRef<{ signature: string; value: T | null } | null>(null);
  const signature = buildSignature(value);
  if (ref.current?.signature === signature) {
    return ref.current.value;
  }
  ref.current = { signature, value };
  return value;
}

function resolveActiveSessionLaunchModelId(
  agentKind: string,
  modelId: string | null,
  requestedModelId: string | null,
): string | null {
  if (agentKind === "gemini") {
    return modelId ?? requestedModelId;
  }
  return requestedModelId ?? modelId;
}

function normalizedControlsSignature(controls: NormalizedSessionControls | null): string {
  if (!controls) {
    return "null";
  }
  return JSON.stringify({
    model: controls.model,
    collaborationMode: controls.collaborationMode,
    mode: controls.mode,
    reasoning: controls.reasoning,
    effort: controls.effort,
    fastMode: controls.fastMode,
    extras: controls.extras,
  });
}

function modelControlSignature(control: NormalizedSessionModelControl | null): string {
  return control ? JSON.stringify(control) : "null";
}

function latestSessionStateUpdateFromEvents(
  events: readonly SessionEventEnvelope[] | null,
): LatestSessionStateUpdate {
  let modelId: string | null | undefined;
  let requestedModelId: string | null | undefined;

  for (let index = (events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = events?.[index]?.event;
    if (event?.type !== "session_state_update") {
      continue;
    }
    if (modelId === undefined && event.modelId !== undefined) {
      modelId = event.modelId ?? null;
    }
    if (requestedModelId === undefined && event.requestedModelId !== undefined) {
      requestedModelId = event.requestedModelId ?? null;
    }
    if (modelId !== undefined && requestedModelId !== undefined) {
      break;
    }
  }

  return {
    modelId: modelId ?? null,
    requestedModelId: requestedModelId ?? null,
    hasModelId: modelId !== undefined,
    hasRequestedModelId: requestedModelId !== undefined,
  };
}

function configIntentsForSession(
  state: Parameters<typeof sessionIntentsForSession>[0],
  clientSessionId: string,
): readonly SessionUpdateConfigIntent[] {
  const intents = sessionIntentsForSession(state, clientSessionId);
  if (intents.length === 0) {
    return EMPTY_CONFIG_INTENTS;
  }
  const configIntents = intents.filter(
    (intent): intent is SessionUpdateConfigIntent => intent.kind === "update_config",
  );
  return configIntents.length > 0 ? configIntents : EMPTY_CONFIG_INTENTS;
}
