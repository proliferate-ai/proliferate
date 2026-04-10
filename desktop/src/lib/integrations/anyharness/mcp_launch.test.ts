import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let persistedState: unknown;
  const connectorSecrets = new Map<string, string>();

  return {
    get persistedState() {
      return persistedState;
    },
    set persistedState(value: unknown) {
      persistedState = value;
    },
    connectorSecrets,
    readPersistedValueMock: vi.fn(async () => persistedState),
    persistValueMock: vi.fn(async (_key: string, value: unknown) => {
      persistedState = structuredClone(value);
    }),
    getConnectorSecretMock: vi.fn(async (connectionId: string, fieldId: string) => (
      connectorSecrets.get(`${connectionId}:${fieldId}`) ?? null
    )),
    setConnectorSecretMock: vi.fn(async (connectionId: string, fieldId: string, value: string) => {
      connectorSecrets.set(`${connectionId}:${fieldId}`, value);
    }),
    deleteConnectorSecretMock: vi.fn(async (connectionId: string, fieldId: string) => {
      connectorSecrets.delete(`${connectionId}:${fieldId}`);
    }),
    syncCloudMcpConnectionMock: vi.fn(async () => undefined),
    deleteCloudMcpConnectionMock: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/infra/preferences-persistence", () => ({
  readPersistedValue: mocks.readPersistedValueMock,
  persistValue: mocks.persistValueMock,
}));

vi.mock("@/platform/tauri/connectors", () => ({
  getConnectorSecret: mocks.getConnectorSecretMock,
  setConnectorSecret: mocks.setConnectorSecretMock,
  deleteConnectorSecret: mocks.deleteConnectorSecretMock,
}));

vi.mock("@/lib/integrations/cloud/mcp_connections", () => ({
  syncCloudMcpConnection: mocks.syncCloudMcpConnectionMock,
  deleteCloudMcpConnection: mocks.deleteCloudMcpConnectionMock,
}));

import { installConnector } from "@/lib/infra/mcp/persistence";
import { resolveSessionMcpServersForLaunch } from "@/lib/integrations/anyharness/mcp_launch";

describe("mcp launch resolution", () => {
  beforeEach(() => {
    mocks.persistedState = undefined;
    mocks.connectorSecrets.clear();
    mocks.readPersistedValueMock.mockClear();
    mocks.persistValueMock.mockClear();
    mocks.getConnectorSecretMock.mockClear();
    mocks.setConnectorSecretMock.mockClear();
    mocks.deleteConnectorSecretMock.mockClear();
    mocks.syncCloudMcpConnectionMock.mockClear();
    mocks.deleteCloudMcpConnectionMock.mockClear();
  });

  it("resolves installed http connectors into session MCP servers", async () => {
    await installConnector("context7", "ctx7sk-example");

    const resolution = await resolveSessionMcpServersForLaunch();

    expect(resolution.warnings).toEqual([]);
    expect(resolution.mcpServers).toHaveLength(1);
    expect(resolution.mcpServers[0]).toMatchObject({
      catalogEntryId: "context7",
      transport: "http",
      url: "https://mcp.context7.com/mcp",
    });
  });

  it("warns when an enabled connector is missing its saved secret", async () => {
    await installConnector("context7", "ctx7sk-example");
    const connectionId = (mocks.persistedState as {
      connections: Array<{ connectionId: string }>;
    }).connections[0]!.connectionId;
    mocks.connectorSecrets.delete(`${connectionId}:api_key`);

    const resolution = await resolveSessionMcpServersForLaunch();

    expect(resolution.mcpServers).toEqual([]);
    expect(resolution.warnings).toEqual([
      expect.objectContaining({
        kind: "missing_secret",
        catalogEntryId: "context7",
      }),
    ]);
  });
});
