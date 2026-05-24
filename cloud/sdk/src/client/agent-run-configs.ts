import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  CloudAgentRunConfig,
  CloudAgentRunConfigDefault,
  CloudAgentRunConfigDefaultOwnerSelection,
  CloudAgentRunConfigDefaultsResponse,
  CloudAgentRunConfigListResponse,
  CreateCloudAgentRunConfigRequest,
  ListCloudAgentRunConfigsOptions,
  SetCloudAgentRunConfigDefaultRequest,
  UpdateCloudAgentRunConfigRequest,
} from "../types/index.js";

type AgentRunConfigListWireResponse =
  | CloudAgentRunConfig[]
  | {
    configs?: CloudAgentRunConfig[];
    agentRunConfigs?: CloudAgentRunConfig[];
    items?: CloudAgentRunConfig[];
  };

type AgentRunConfigDefaultsWireResponse =
  | CloudAgentRunConfigDefault[]
  | {
    defaults?: CloudAgentRunConfigDefault[];
    items?: CloudAgentRunConfigDefault[];
  };

export async function listAgentRunConfigs(
  client?: ProliferateCloudClient,
): Promise<CloudAgentRunConfigListResponse>;
export async function listAgentRunConfigs(
  options?: ListCloudAgentRunConfigsOptions,
  client?: ProliferateCloudClient,
): Promise<CloudAgentRunConfigListResponse>;
export async function listAgentRunConfigs(
  optionsOrClient: ListCloudAgentRunConfigsOptions | ProliferateCloudClient = {},
  maybeClient?: ProliferateCloudClient,
): Promise<CloudAgentRunConfigListResponse> {
  const { options, client } = resolveListArgs(optionsOrClient, maybeClient);
  const response = await client.requestJson<AgentRunConfigListWireResponse>({
    method: "GET",
    path: "/v1/cloud/agent-run-configs",
    query: {
      ownerScope: options.ownerScope,
      organizationId: options.organizationId,
      agentKind: options.agentKind,
      usableIn: options.usableIn,
      status: options.status,
    },
  });
  return normalizeAgentRunConfigList(response);
}

export async function listAgentRunConfigDefaults(
  client?: ProliferateCloudClient,
): Promise<CloudAgentRunConfigDefaultsResponse>;
export async function listAgentRunConfigDefaults(
  options?: CloudAgentRunConfigDefaultOwnerSelection,
  client?: ProliferateCloudClient,
): Promise<CloudAgentRunConfigDefaultsResponse>;
export async function listAgentRunConfigDefaults(
  optionsOrClient: CloudAgentRunConfigDefaultOwnerSelection | ProliferateCloudClient = {},
  maybeClient?: ProliferateCloudClient,
): Promise<CloudAgentRunConfigDefaultsResponse> {
  const { options, client } = resolveDefaultArgs(optionsOrClient, maybeClient);
  const response = await client.requestJson<AgentRunConfigDefaultsWireResponse>({
    method: "GET",
    path: "/v1/cloud/agent-run-configs/defaults",
    query: {
      ownerScope: options.ownerScope,
      organizationId: options.organizationId,
    },
  });
  return normalizeAgentRunConfigDefaults(response);
}

export async function setAgentRunConfigDefault(
  agentKind: string,
  body: SetCloudAgentRunConfigDefaultRequest,
  options: CloudAgentRunConfigDefaultOwnerSelection = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudAgentRunConfigDefault> {
  return client.requestJson<CloudAgentRunConfigDefault>({
    method: "PUT",
    path: "/v1/cloud/agent-run-configs/defaults/{agent_kind}",
    pathParams: { agent_kind: agentKind },
    query: {
      ownerScope: options.ownerScope,
      organizationId: options.organizationId,
    },
    body,
  });
}

export async function getAgentRunConfig(
  configId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudAgentRunConfig> {
  return client.requestJson<CloudAgentRunConfig>({
    method: "GET",
    path: "/v1/cloud/agent-run-configs/{config_id}",
    pathParams: { config_id: configId },
  });
}

export async function createAgentRunConfig(
  body: CreateCloudAgentRunConfigRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudAgentRunConfig> {
  return client.requestJson<CloudAgentRunConfig>({
    method: "POST",
    path: "/v1/cloud/agent-run-configs",
    body,
  });
}

export async function updateAgentRunConfig(
  configId: string,
  body: UpdateCloudAgentRunConfigRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudAgentRunConfig> {
  return client.requestJson<CloudAgentRunConfig>({
    method: "PATCH",
    path: "/v1/cloud/agent-run-configs/{config_id}",
    pathParams: { config_id: configId },
    body,
  });
}

export async function deleteAgentRunConfig(
  configId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson<unknown>({
    method: "DELETE",
    path: "/v1/cloud/agent-run-configs/{config_id}",
    pathParams: { config_id: configId },
  });
}

function resolveListArgs(
  optionsOrClient: ListCloudAgentRunConfigsOptions | ProliferateCloudClient,
  maybeClient?: ProliferateCloudClient,
): {
  options: ListCloudAgentRunConfigsOptions;
  client: ProliferateCloudClient;
} {
  if (isProliferateCloudClient(optionsOrClient)) {
    return { options: {}, client: optionsOrClient };
  }
  return {
    options: optionsOrClient,
    client: maybeClient ?? getProliferateClient(),
  };
}

function resolveDefaultArgs(
  optionsOrClient: CloudAgentRunConfigDefaultOwnerSelection | ProliferateCloudClient,
  maybeClient?: ProliferateCloudClient,
): {
  options: CloudAgentRunConfigDefaultOwnerSelection;
  client: ProliferateCloudClient;
} {
  if (isProliferateCloudClient(optionsOrClient)) {
    return { options: {}, client: optionsOrClient };
  }
  return {
    options: optionsOrClient,
    client: maybeClient ?? getProliferateClient(),
  };
}

function normalizeAgentRunConfigList(
  response: AgentRunConfigListWireResponse,
): CloudAgentRunConfigListResponse {
  if (Array.isArray(response)) {
    return { configs: response };
  }
  return {
    configs: response.configs ?? response.agentRunConfigs ?? response.items ?? [],
  };
}

function normalizeAgentRunConfigDefaults(
  response: AgentRunConfigDefaultsWireResponse,
): CloudAgentRunConfigDefaultsResponse {
  if (Array.isArray(response)) {
    return { defaults: response };
  }
  return {
    defaults: response.defaults ?? response.items ?? [],
  };
}

function isProliferateCloudClient(value: unknown): value is ProliferateCloudClient {
  return Boolean(
    value
    && typeof value === "object"
    && "requestJson" in value
    && "buildUrl" in value,
  );
}
