import { getPendingSessionConfigChange, type PendingSessionConfigChanges } from "@proliferate/product-domain/sessions/pending-config";
import {
  pendingConfigChangesForSessionIntents,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import type {
  SessionUpdateConfigIntent,
} from "@proliferate/product-domain/sessions/intents/session-intent-model";
import { sessionIntentsForSession } from "@proliferate/product-domain/sessions/intents/session-intent-state";
import type { TranscriptState } from "@anyharness/sdk";
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
      directoryPendingConfigChanges: normalizeEmptyPendingConfigChanges(
        entry?.pendingConfigChanges,
      ),
      currentModelConfigId: modelControl?.rawConfigId ?? null,
      modelControl,
    };
  }));
  const stableModelControl = useStableModelControl(slice.modelControl);
  const pendingConfigChanges = useMemo(
    () => mergePendingConfigChanges(
      slice.directoryPendingConfigChanges,
      intentPendingConfigChanges,
    ),
    [intentPendingConfigChanges, slice.directoryPendingConfigChanges],
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
    const modelId = pendingModelId ?? slice.requestedModelId ?? slice.modelId ?? null;
    return modelId ? { kind: slice.agentKind, modelId } : null;
  }, [pendingModelId, slice.agentKind, slice.modelId, slice.requestedModelId]);

  return {
    ...slice,
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
      normalizedControls: entry?.liveConfig?.normalizedControls ?? null,
      directoryPendingConfigChanges: normalizeEmptyPendingConfigChanges(
        entry?.pendingConfigChanges,
      ),
    };
  }));
  const stableNormalizedControls = useStableNormalizedControls(slice.normalizedControls);
  const pendingConfigChanges = useMemo(
    () => mergePendingConfigChanges(
      slice.directoryPendingConfigChanges,
      intentPendingConfigChanges,
    ),
    [intentPendingConfigChanges, slice.directoryPendingConfigChanges],
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
