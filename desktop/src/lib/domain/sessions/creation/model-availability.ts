import type {
  Session,
} from "@anyharness/sdk";
import type { DesktopAgentLaunchRemediation as ModelLaunchRemediation } from "@/lib/domain/agents/cloud-launch-catalog";
import type {
  SessionConfigModel,
  SessionConfigModelRegistry,
  SessionLaunchAgent,
} from "@/lib/domain/chat/launch/session-config";

interface SessionModelAvailabilityCatalog {
  agents: SessionLaunchAgent[];
}

export interface PausedSessionModelAvailability {
  id: string;
  sessionId: string;
  workspaceId: string;
  agentKind: string;
  providerDisplayName: string;
  requestedModelId: string;
  requestedModelDisplayName: string;
  currentModelId: string;
  currentModelDisplayName: string;
  remediation: ModelLaunchRemediation | null;
}

function modelMatchesId(model: Pick<SessionConfigModel, "id" | "aliases">, modelId: string): boolean {
  return model.id === modelId || (model.aliases ?? []).includes(modelId);
}

function findRegistryModel(
  registries: SessionConfigModelRegistry[],
  agentKind: string,
  modelId: string,
) {
  const registry = registries.find((candidate) => candidate.kind === agentKind) ?? null;
  const model = registry?.models.find((candidate) => modelMatchesId(candidate, modelId)) ?? null;
  return { registry, model };
}

function launchCatalogExposesModel(input: {
  launchCatalog: SessionModelAvailabilityCatalog;
  agentKind: string;
  requestedModelId: string;
  requestedModel: SessionConfigModel;
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
  registries: SessionConfigModelRegistry[];
  launchCatalog: SessionModelAvailabilityCatalog;
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
  registries: SessionConfigModelRegistry[];
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
