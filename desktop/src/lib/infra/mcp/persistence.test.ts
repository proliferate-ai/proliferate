import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectOAuthConnectorResult,
  GetValidOAuthAccessTokenResult,
} from "@/platform/tauri/mcp-oauth";

const mocks = vi.hoisted(() => {
  let persistedState: unknown;
  const connectorSecrets = new Map<string, string>();
  const oauthBundles = new Set<string>();

  return {
    get persistedState() {
      return persistedState;
    },
    set persistedState(value: unknown) {
      persistedState = value;
    },
    connectorSecrets,
    oauthBundles,
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
    connectOAuthConnectorMock: vi.fn(async (input: { connectionId: string }): Promise<ConnectOAuthConnectorResult> => {
      oauthBundles.add(input.connectionId);
      return { kind: "completed" as const };
    }),
    getOAuthConnectorBundleStateMock: vi.fn(async (connectionId: string) => ({
      hasBundle: oauthBundles.has(connectionId),
      expiresAt: null,
    })),
    getValidOAuthAccessTokenMock: vi.fn(async (): Promise<GetValidOAuthAccessTokenResult> => ({
      kind: "missing",
    })),
    deleteOAuthConnectorBundleMock: vi.fn(async (connectionId: string) => {
      oauthBundles.delete(connectionId);
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

vi.mock("@/platform/tauri/mcp-oauth", () => ({
  connectOAuthConnector: mocks.connectOAuthConnectorMock,
  getOAuthConnectorBundleState: mocks.getOAuthConnectorBundleStateMock,
  getValidOAuthAccessToken: mocks.getValidOAuthAccessTokenMock,
  deleteOAuthConnectorBundle: mocks.deleteOAuthConnectorBundleMock,
}));

vi.mock("@/lib/integrations/cloud/mcp_connections", () => ({
  syncCloudMcpConnection: mocks.syncCloudMcpConnectionMock,
  deleteCloudMcpConnection: mocks.deleteCloudMcpConnectionMock,
}));

import {
  connectOAuthConnector,
  deleteConnector,
  installConnector,
  loadConnectorPaneData,
  reconnectOAuthConnector,
} from "@/lib/infra/mcp/persistence";
import { retryConnectorSync, retryPendingConnectorSync } from "@/lib/infra/mcp/sync";

describe("mcp connector persistence", () => {
  beforeEach(() => {
    mocks.persistedState = undefined;
    mocks.connectorSecrets.clear();
    mocks.oauthBundles.clear();
    mocks.readPersistedValueMock.mockClear();
    mocks.persistValueMock.mockClear();
    mocks.getConnectorSecretMock.mockClear();
    mocks.setConnectorSecretMock.mockClear();
    mocks.deleteConnectorSecretMock.mockClear();
    mocks.connectOAuthConnectorMock.mockClear();
    mocks.getOAuthConnectorBundleStateMock.mockClear();
    mocks.getValidOAuthAccessTokenMock.mockClear();
    mocks.deleteOAuthConnectorBundleMock.mockClear();
    mocks.syncCloudMcpConnectionMock.mockClear();
    mocks.deleteCloudMcpConnectionMock.mockClear();
    mocks.setConnectorSecretMock.mockImplementation(async (connectionId: string, fieldId: string, value: string) => {
      mocks.connectorSecrets.set(`${connectionId}:${fieldId}`, value);
    });
    mocks.getConnectorSecretMock.mockImplementation(async (connectionId: string, fieldId: string) => (
      mocks.connectorSecrets.get(`${connectionId}:${fieldId}`) ?? null
    ));
  });

  it("loads installed connectors and removes them from available immediately", async () => {
    await installConnector("context7", "ctx7sk-example");

    const paneData = await loadConnectorPaneData();

    expect(paneData.installed).toHaveLength(1);
    expect(paneData.installed[0]?.catalogEntry.id).toBe("context7");
    expect(paneData.available.map((entry) => entry.id)).not.toContain("context7");
  });

  it("does not persist connector metadata if the secret cannot be read back", async () => {
    mocks.setConnectorSecretMock.mockImplementation(async () => undefined);

    await expect(installConnector("context7", "ctx7sk-example")).rejects.toThrow(
      "Couldn't save Context7. Try again.",
    );

    const paneData = await loadConnectorPaneData();
    expect(paneData.installed).toEqual([]);
    expect(paneData.available.map((entry) => entry.id)).toContain("context7");
    expect(mocks.deleteConnectorSecretMock).toHaveBeenCalledTimes(1);
    expect(mocks.syncCloudMcpConnectionMock).not.toHaveBeenCalled();
  });

  it("filters inactive catalog entries out of the available list", async () => {
    const paneData = await loadConnectorPaneData();
    const availableIds = paneData.available.map((entry) => entry.id);

    expect(availableIds).not.toContain("brave_search");
    expect(availableIds).not.toContain("openweather");
    expect(availableIds).not.toContain("supabase");
  });

  it("marks cloud-sync connectors as degraded until retry succeeds", async () => {
    mocks.syncCloudMcpConnectionMock.mockRejectedValueOnce(new Error("offline"));

    const result = await installConnector("context7", "ctx7sk-example");
    expect(result).toEqual({ degraded: true });

    const degradedData = await loadConnectorPaneData();
    const record = degradedData.installed[0]!;
    expect(record.metadata.syncState).toBe("degraded");

    mocks.syncCloudMcpConnectionMock.mockResolvedValue(undefined);
    const recovered = await retryConnectorSync(record.metadata.connectionId);

    expect(recovered).toBe(true);

    const recoveredData = await loadConnectorPaneData();
    expect(recoveredData.installed[0]?.metadata.syncState).toBe("synced");
  });

  it("retries pending cloud deletes from tombstones", async () => {
    await installConnector("context7", "ctx7sk-example");
    const record = (await loadConnectorPaneData()).installed[0]!;

    mocks.deleteCloudMcpConnectionMock.mockRejectedValueOnce(new Error("still offline"));
    await deleteConnector(record.metadata.connectionId);

    expect((mocks.persistedState as { pendingDeletes: unknown[] }).pendingDeletes).toHaveLength(1);

    mocks.deleteCloudMcpConnectionMock.mockResolvedValue(undefined);
    const changed = await retryPendingConnectorSync();

    expect(changed).toBe(true);
    expect((mocks.persistedState as { pendingDeletes: unknown[] }).pendingDeletes).toHaveLength(0);
  });

  it("installs zero-field stdio connectors without cloud secret sync", async () => {
    const result = await installConnector("filesystem", "");

    expect(result).toEqual({ degraded: false });
    expect(mocks.syncCloudMcpConnectionMock).not.toHaveBeenCalled();

    const paneData = await loadConnectorPaneData();
    expect(paneData.installed).toHaveLength(1);
    expect(paneData.installed[0]?.broken).toBe(false);
  });

  it("connects OAuth connectors through the native flow before persisting metadata", async () => {
    const result = await connectOAuthConnector("linear");

    expect(result).toEqual({ kind: "completed" });
    const paneData = await loadConnectorPaneData();
    expect(paneData.installed).toHaveLength(1);
    expect(paneData.installed[0]?.catalogEntry.id).toBe("linear");
    expect(paneData.installed[0]?.broken).toBe(false);
    expect(mocks.connectOAuthConnectorMock).toHaveBeenCalledTimes(1);
  });

  it("re-reads connector state after OAuth completes before saving metadata", async () => {
    await installConnector("context7", "ctx7sk-example");
    mocks.connectOAuthConnectorMock.mockImplementationOnce(async (input: { connectionId: string }) => {
      mocks.oauthBundles.add(input.connectionId);
      const state = mocks.persistedState as {
        connections: Array<Record<string, unknown>>;
        pendingDeletes: unknown[];
      };
      state.connections = [
        ...state.connections,
        {
          connectionId: "filesystem-1",
          catalogEntryId: "filesystem",
          enabled: true,
          serverName: "filesystem",
          syncState: "synced",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
          lastSyncedAt: "2026-04-10T00:00:00.000Z",
        },
      ];
      return { kind: "completed" as const };
    });

    await connectOAuthConnector("linear");

    const paneData = await loadConnectorPaneData();
    expect(paneData.installed.map((record) => record.catalogEntry.id)).toEqual(
      expect.arrayContaining(["linear", "context7", "filesystem"]),
    );
  });

  it("does not persist connector metadata when the OAuth flow is canceled", async () => {
    mocks.connectOAuthConnectorMock.mockResolvedValueOnce({ kind: "canceled" });

    const result = await connectOAuthConnector("linear");

    expect(result).toEqual({ kind: "canceled" });
    expect((await loadConnectorPaneData()).installed).toEqual([]);
    expect(mocks.deleteOAuthConnectorBundleMock).not.toHaveBeenCalled();
  });

  it("cleans up the OAuth bundle if reconnect metadata persistence fails", async () => {
    await connectOAuthConnector("linear");
    const connectionId = (mocks.persistedState as {
      connections: Array<{ connectionId: string }>;
    }).connections[0]!.connectionId;

    mocks.persistValueMock.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });

    await expect(reconnectOAuthConnector(connectionId)).rejects.toThrow("disk full");
    expect(mocks.deleteOAuthConnectorBundleMock).toHaveBeenCalledWith(connectionId);
  });

  it("reconnect writes against the latest connector state", async () => {
    await connectOAuthConnector("linear");
    const connectionId = (mocks.persistedState as {
      connections: Array<{ connectionId: string }>;
      pendingDeletes: unknown[];
    }).connections[0]!.connectionId;

    mocks.connectOAuthConnectorMock.mockImplementationOnce(async () => {
      const state = mocks.persistedState as {
        connections: Array<Record<string, unknown>>;
        pendingDeletes: unknown[];
      };
      state.connections = [
        ...state.connections,
        {
          connectionId: "filesystem-1",
          catalogEntryId: "filesystem",
          enabled: true,
          serverName: "filesystem",
          syncState: "synced",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
          lastSyncedAt: "2026-04-10T00:00:00.000Z",
        },
      ];
      return { kind: "completed" as const };
    });

    await reconnectOAuthConnector(connectionId);

    const paneData = await loadConnectorPaneData();
    expect(paneData.installed.map((record) => record.catalogEntry.id)).toEqual(
      expect.arrayContaining(["linear", "filesystem"]),
    );
  });

  it("keeps Supabase unavailable until confidential-client auth is implemented", async () => {
    await expect(connectOAuthConnector("supabase")).rejects.toThrow(
      "Supabase isn't available yet.",
    );
    expect(mocks.connectOAuthConnectorMock).not.toHaveBeenCalled();
  });
});
