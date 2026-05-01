import type {
  ModelRegistry,
  ModelRegistryModel,
  Session,
  WorkspaceSessionLaunchCatalog,
} from "@anyharness/sdk";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import type { SessionSlot } from "@/stores/sessions/harness-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/latency-flow";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { resolveCoworkDefaultSessionModeId } from "@/lib/domain/cowork/session-mode-defaults";
import type { PausedSessionModelAvailability } from "@/hooks/sessions/use-session-model-availability-workflow";

export function resolveSessionCreationModeId(input: {
  explicitModeId?: string | null;
  workspaceSurface: string | null | undefined;
  agentKind: string;
  preferredModeId?: string | null;
}): string | undefined {
  const explicitModeId = input.explicitModeId?.trim() || undefined;
  if (explicitModeId) {
    return explicitModeId;
  }

  if (input.workspaceSurface === "cowork") {
    return resolveCoworkDefaultSessionModeId(input.agentKind);
  }

  return input.preferredModeId?.trim() || undefined;
}

export function buildLatencyRequestOptions(latencyFlowId?: string | null) {
  const headers = getLatencyFlowRequestHeaders(latencyFlowId);
  return headers ? { headers } : undefined;
}

export function replacePendingSessionSlot(
  pendingSessionId: string,
  nextSessionId: string,
  slot: SessionSlot,
  options?: { remapActiveSession?: boolean },
): void {
  useHarnessStore.setState((state) => {
    const nextSlots = { ...state.sessionSlots };
    delete nextSlots[pendingSessionId];
    nextSlots[nextSessionId] = slot;
    const shouldRemapActiveSession =
      options?.remapActiveSession !== false
      && state.activeSessionId === pendingSessionId;
    const shouldClearDanglingActiveSession =
      !shouldRemapActiveSession && state.activeSessionId === pendingSessionId;
    const nextActiveSessionId = shouldRemapActiveSession
      ? nextSessionId
      : shouldClearDanglingActiveSession
        ? null
      : state.activeSessionId;
    const activeSessionChanged = nextActiveSessionId !== state.activeSessionId;

    return {
      activeSessionId: nextActiveSessionId,
      activeSessionVersion: activeSessionChanged
        ? state.activeSessionVersion + 1
        : state.activeSessionVersion,
      sessionSlots: nextSlots,
    };
  });
}

export function removeSessionSlot(sessionId: string): void {
  useHarnessStore.setState((state) => {
    if (!state.sessionSlots[sessionId]) {
      return state;
    }

    const nextSlots = { ...state.sessionSlots };
    delete nextSlots[sessionId];
    const shouldClearActiveSession = state.activeSessionId === sessionId;

    return {
      activeSessionId: shouldClearActiveSession ? null : state.activeSessionId,
      activeSessionVersion: shouldClearActiveSession
        ? state.activeSessionVersion + 1
        : state.activeSessionVersion,
      sessionSlots: nextSlots,
    };
  });
}

export function reportConnectorLaunchWarnings(
  warnings: ConnectorLaunchResolutionWarning[],
  showToast: (message: string, type?: "error" | "info") => void,
) {
  if (warnings.length === 0) {
    return;
  }

  for (const warning of warnings) {
    trackProductEvent("connector_skipped_at_launch", {
      connector_id: warning.catalogEntryId,
      reason_kind: warning.kind,
    });
  }

  if (warnings.length === 1) {
    const warning = warnings[0]!;
    if (warning.kind === "unsupported_target") {
      showToast(`${warning.connectorName} wasn't available in this session because it only supports local runtimes.`, "info");
      return;
    }
    if (warning.kind === "command_missing") {
      showToast(`${warning.connectorName} wasn't available in this session because its local command wasn't installed.`, "info");
      return;
    }
    if (warning.kind === "workspace_path_unresolved") {
      showToast(`${warning.connectorName} wasn't available in this session because the workspace path couldn't be resolved.`, "info");
      return;
    }
    if (warning.kind === "needs_reconnect") {
      showToast(`${warning.connectorName} wasn't available in this session because it needs reconnecting.`, "info");
      return;
    }
    showToast(`${warning.connectorName} wasn't available in this session because it needs a token.`, "info");
    return;
  }

  showToast(`${warnings.length} connectors weren't available in this session.`, "info");
}

function modelMatchesId(model: Pick<ModelRegistryModel, "id" | "aliases">, modelId: string): boolean {
  return model.id === modelId || (model.aliases ?? []).includes(modelId);
}

function findRegistryModel(
  registries: ModelRegistry[],
  agentKind: string,
  modelId: string,
) {
  const registry = registries.find((candidate) => candidate.kind === agentKind) ?? null;
  const model = registry?.models.find((candidate) => modelMatchesId(candidate, modelId)) ?? null;
  return { registry, model };
}

function launchCatalogExposesModel(input: {
  launchCatalog: WorkspaceSessionLaunchCatalog;
  agentKind: string;
  requestedModelId: string;
  requestedModel: ModelRegistryModel;
}): boolean {
  const agent = input.launchCatalog.agents.find((candidate) =>
    candidate.kind === input.agentKind
  );
  if (!agent) {
    return false;
  }

  const acceptedIds = new Set([
    input.requestedModelId,
    input.requestedModel.id,
    ...(input.requestedModel.aliases ?? []),
  ]);
  return agent.models.some((model) => acceptedIds.has(model.id));
}

export function hasImmediateLaunchModelMismatch(input: {
  session: Session;
  agentKind: string;
  registries: ModelRegistry[];
  launchCatalog: WorkspaceSessionLaunchCatalog;
}): boolean {
  const requestedModelId = input.session.requestedModelId;
  const currentModelId = input.session.modelId;
  if (!requestedModelId || !currentModelId || requestedModelId === currentModelId) {
    return false;
  }

  const requested = findRegistryModel(
    input.registries,
    input.agentKind,
    requestedModelId,
  );
  if (!requested.model?.launchRemediation) {
    return false;
  }

  return !launchCatalogExposesModel({
    launchCatalog: input.launchCatalog,
    agentKind: input.agentKind,
    requestedModelId,
    requestedModel: requested.model,
  });
}

export function buildPausedModelAvailability(input: {
  session: Session;
  workspaceId: string;
  agentKind: string;
  registries: ModelRegistry[];
}): PausedSessionModelAvailability {
  const requestedModelId = input.session.requestedModelId ?? "";
  const currentModelId = input.session.modelId ?? "";
  const requested = findRegistryModel(input.registries, input.agentKind, requestedModelId);
  const current = findRegistryModel(input.registries, input.agentKind, currentModelId);
  const providerDisplayName =
    requested.registry?.displayName
    ?? current.registry?.displayName
    ?? input.agentKind;

  return {
    id: `${input.session.id}:${requestedModelId}:${currentModelId}`,
    sessionId: input.session.id,
    workspaceId: input.workspaceId,
    agentKind: input.agentKind,
    providerDisplayName,
    requestedModelId,
    requestedModelDisplayName: requested.model?.displayName ?? requestedModelId,
    currentModelId,
    currentModelDisplayName: current.model?.displayName ?? currentModelId,
    remediation: requested.model?.launchRemediation ?? null,
  };
}
