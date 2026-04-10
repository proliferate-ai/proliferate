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

import {
  deleteConnector,
  installConnector,
  loadConnectorPaneData,
} from "@/lib/infra/mcp/persistence";
import { retryConnectorSync, retryPendingConnectorSync } from "@/lib/infra/mcp/sync";

describe("mcp connector persistence", () => {
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
});
