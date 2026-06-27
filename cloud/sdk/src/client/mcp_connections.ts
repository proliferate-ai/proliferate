import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import {
  createIntegrationAccount,
  deleteIntegrationAccount,
  listIntegrationAccounts,
  listIntegrationDefinitions,
  patchIntegrationAccount,
  type IntegrationAccount,
  type IntegrationDefinition,
} from "./integrations.js";
import type {
  CloudMcpConnection,
  CloudMcpConnectionsResponse,
  CreateCloudMcpConnectionRequest,
  PatchCloudMcpConnectionRequest,
  PublicizeCloudMcpConnectionRequest,
  PutCloudMcpSecretAuthRequest,
} from "../types/index.js";

export async function listCloudMcpConnections(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnectionsResponse> {
  const accounts = await listIntegrationAccounts(client);
  return { connections: accounts.map(accountToConnection) };
}

export async function createCloudMcpConnection(
  body: CreateCloudMcpConnectionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnection> {
  const definition = await loadDefinition(client, body.catalogEntryId);
  const account = await createIntegrationAccount({
    definitionId: definition.id,
    authKind: preferredAuthKind(definition),
    settings: body.settings ?? {},
  }, client);
  if (body.enabled === false) {
    const patched = await patchIntegrationAccount(account.id, { enabled: false }, client);
    return accountToConnection(patched);
  }
  return accountToConnection(account);
}

export async function patchCloudMcpConnection(
  connectionId: string,
  body: PatchCloudMcpConnectionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnection> {
  return accountToConnection(
    await patchIntegrationAccount(connectionId, {
      enabled: body.enabled ?? undefined,
      settings: body.settings ?? undefined,
    }, client),
  );
}

export async function publicizeCloudMcpConnection(
  connectionId: string,
  _body: PublicizeCloudMcpConnectionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnection> {
  const account = await loadAccount(client, connectionId);
  return accountToConnection(account);
}

export async function unpublicizeCloudMcpConnection(
  connectionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnection> {
  const account = await loadAccount(client, connectionId);
  return accountToConnection(account);
}

export async function putCloudMcpSecretAuth(
  connectionId: string,
  body: PutCloudMcpSecretAuthRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnection> {
  const token = Object.values(body.secretFields ?? {}).find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return accountToConnection(
    await patchIntegrationAccount(connectionId, { apiKey: token ?? "" }, client),
  );
}

export async function deleteCloudMcpConnectionV2(
  connectionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await deleteIntegrationAccount(connectionId, client);
}

function accountToConnection(account: IntegrationAccount): CloudMcpConnection {
  return {
    connectionId: account.id,
    ownerScope: account.ownerScope,
    ownerUserId: account.ownerUserId,
    organizationId: account.organizationId,
    catalogEntryId: account.definitionId,
    catalogEntryVersion: 1,
    serverName: account.definition.namespace,
    enabled: account.enabled,
    publicToOrg: false,
    publicOrganizationId: null,
    publicStatus: "private",
    publicUpdatedAt: null,
    publicUpdatedByUserId: null,
    authKind: account.authKind === "oauth2" ? "oauth" : account.authKind === "api_key" ? "secret" : "none",
    authStatus: account.status === "ready" ? "ready" : account.status === "error" ? "error" : "needs_reconnect",
    settings: account.settings,
    configVersion: 1,
    authVersion: account.authVersion,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function loadDefinition(
  client: ProliferateCloudClient,
  definitionId: string,
): Promise<IntegrationDefinition> {
  const definitions = await listIntegrationDefinitions({}, client);
  const definition = definitions.find((candidate) => candidate.id === definitionId);
  if (!definition) {
    throw new Error("Integration definition was not found.");
  }
  return definition;
}

async function loadAccount(
  client: ProliferateCloudClient,
  accountId: string,
): Promise<IntegrationAccount> {
  const accounts = await listIntegrationAccounts(client);
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    throw new Error("Integration account was not found.");
  }
  return account;
}

function preferredAuthKind(definition: IntegrationDefinition): "oauth2" | "api_key" | "none" {
  if (definition.authModes.some((mode) => mode.kind === "oauth2")) {
    return "oauth2";
  }
  if (definition.authModes.some((mode) => mode.kind === "api_key")) {
    return "api_key";
  }
  return "none";
}
