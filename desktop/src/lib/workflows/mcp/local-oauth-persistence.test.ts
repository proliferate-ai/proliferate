import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudMcpConnection } from "@/lib/access/cloud/client";
import type { ConnectorCatalogEntry, InstalledConnectorRecord } from "@/lib/domain/mcp/types";

const SETUP_ID = "00000000-0000-4000-8000-000000000001";
const SETUP_ID_A = "00000000-0000-4000-8000-00000000000a";
const SETUP_ID_B = "00000000-0000-4000-8000-00000000000b";

const mocks = vi.hoisted(() => ({
  createCloudMcpConnection: vi.fn(),
  deleteCloudMcpConnectionV2: vi.fn(),
  startGoogleWorkspaceMcpAuth: vi.fn(),
  cancelGoogleWorkspaceMcpAuth: vi.fn(),
  deleteGoogleWorkspaceMcpLocalData: vi.fn(),
  reconcileGoogleWorkspaceMcpPendingSetups: vi.fn(),
  getGoogleWorkspaceMcpCredentialStatus: vi.fn(),
}));

vi.mock("@/lib/access/cloud/mcp_connections", () => ({
  createCloudMcpConnection: mocks.createCloudMcpConnection,
  deleteCloudMcpConnectionV2: mocks.deleteCloudMcpConnectionV2,
}));

vi.mock("@/lib/access/tauri/google-workspace-mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access/tauri/google-workspace-mcp")>();
  return {
    ...actual,
    startGoogleWorkspaceMcpAuth: mocks.startGoogleWorkspaceMcpAuth,
    cancelGoogleWorkspaceMcpAuth: mocks.cancelGoogleWorkspaceMcpAuth,
    deleteGoogleWorkspaceMcpLocalData: mocks.deleteGoogleWorkspaceMcpLocalData,
    reconcileGoogleWorkspaceMcpPendingSetups: mocks.reconcileGoogleWorkspaceMcpPendingSetups,
    getGoogleWorkspaceMcpCredentialStatus: mocks.getGoogleWorkspaceMcpCredentialStatus,
  };
});

import { LocalMcpOAuthError } from "@/lib/access/tauri/google-workspace-mcp";
import {
  augmentLocalOAuthInstalledStatus,
  cancelLocalOAuthConnectorConnect,
  deleteLocalOAuthConnectorDataBeforeCloudDelete,
  installLocalOAuthConnector,
  reconnectLocalOAuthConnector,
} from "@/lib/workflows/mcp/local-oauth-persistence";

describe("local OAuth MCP persistence", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(SETUP_ID);
    mocks.createCloudMcpConnection.mockReset();
    mocks.deleteCloudMcpConnectionV2.mockReset();
    mocks.startGoogleWorkspaceMcpAuth.mockReset();
    mocks.cancelGoogleWorkspaceMcpAuth.mockReset();
    mocks.deleteGoogleWorkspaceMcpLocalData.mockReset();
    mocks.reconcileGoogleWorkspaceMcpPendingSetups.mockReset();
    mocks.getGoogleWorkspaceMcpCredentialStatus.mockReset();
    mocks.createCloudMcpConnection.mockResolvedValue(gmailConnection());
    mocks.deleteCloudMcpConnectionV2.mockResolvedValue(undefined);
    mocks.startGoogleWorkspaceMcpAuth.mockResolvedValue({
      status: "completed",
      userGoogleEmail: "user@example.com",
    });
    mocks.cancelGoogleWorkspaceMcpAuth.mockResolvedValue({ ok: true });
    mocks.deleteGoogleWorkspaceMcpLocalData.mockResolvedValue({ status: "deleted" });
    mocks.reconcileGoogleWorkspaceMcpPendingSetups.mockResolvedValue({ ok: true });
    mocks.getGoogleWorkspaceMcpCredentialStatus.mockResolvedValue({ status: "ready" });
  });

  it("installs Gmail local OAuth by authorizing locally, creating cloud state, and reconciling", async () => {
    await installLocalOAuthConnector(gmailCatalogEntry());

    expect(mocks.startGoogleWorkspaceMcpAuth).toHaveBeenCalledWith({
      setupId: SETUP_ID,
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
    });
    expect(mocks.createCloudMcpConnection).toHaveBeenCalledWith({
      catalogEntryId: "gmail",
      settings: { userGoogleEmail: "user@example.com" },
      enabled: true,
    });
    expect(mocks.reconcileGoogleWorkspaceMcpPendingSetups).toHaveBeenCalledWith({
      gmailConnections: [{
        connectionId: "conn_gmail",
        userGoogleEmail: "user@example.com",
      }],
    });
    expect(mocks.deleteCloudMcpConnectionV2).not.toHaveBeenCalled();
    expect(mocks.deleteGoogleWorkspaceMcpLocalData).not.toHaveBeenCalled();
  });

  it("rolls back cloud and local Gmail data when cancellation happens after cloud creation", async () => {
    const reconcile = deferred<{ ok: true }>();
    mocks.reconcileGoogleWorkspaceMcpPendingSetups.mockReturnValue(reconcile.promise);

    const installPromise = installLocalOAuthConnector(gmailCatalogEntry());
    await vi.waitFor(() => {
      expect(mocks.reconcileGoogleWorkspaceMcpPendingSetups).toHaveBeenCalled();
    });
    await cancelLocalOAuthConnectorConnect();
    reconcile.resolve({ ok: true });

    await expect(installPromise).rejects.toMatchObject({ code: "cancelled" });
    expect(mocks.cancelGoogleWorkspaceMcpAuth).toHaveBeenCalledWith({ setupId: SETUP_ID });
    expect(mocks.deleteCloudMcpConnectionV2).toHaveBeenCalledWith("conn_gmail");
    expect(mocks.deleteGoogleWorkspaceMcpLocalData).toHaveBeenCalledWith({
      setupId: SETUP_ID,
      userGoogleEmail: "user@example.com",
    });
  });

  it("deletes local Gmail data when cloud storage fails after resolving the Google account", async () => {
    const cloudError = new Error("cloud create failed");
    mocks.createCloudMcpConnection.mockRejectedValue(cloudError);

    await expect(installLocalOAuthConnector(gmailCatalogEntry())).rejects.toBe(cloudError);

    expect(mocks.deleteCloudMcpConnectionV2).not.toHaveBeenCalled();
    expect(mocks.deleteGoogleWorkspaceMcpLocalData).toHaveBeenCalledWith({
      setupId: SETUP_ID,
      userGoogleEmail: "user@example.com",
    });
  });

  it("cancels every pending local OAuth setup and marks them cancelled", async () => {
    const setups = new Map<string, Deferred<AuthResult>>();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(SETUP_ID_A)
      .mockReturnValueOnce(SETUP_ID_B);
    mocks.startGoogleWorkspaceMcpAuth.mockImplementation(({ setupId }) => {
      const setup = deferred<AuthResult>();
      setups.set(setupId, setup);
      return setup.promise;
    });

    const firstInstall = installLocalOAuthConnector(gmailCatalogEntry());
    const secondInstall = installLocalOAuthConnector(gmailCatalogEntry());
    await vi.waitFor(() => {
      expect(mocks.startGoogleWorkspaceMcpAuth).toHaveBeenCalledTimes(2);
    });

    await cancelLocalOAuthConnectorConnect();
    setups.get(SETUP_ID_A)?.resolve({
      status: "completed",
      userGoogleEmail: "first@example.com",
    });
    setups.get(SETUP_ID_B)?.resolve({
      status: "completed",
      userGoogleEmail: "second@example.com",
    });

    await Promise.all([
      expect(firstInstall).rejects.toMatchObject({ code: "cancelled" }),
      expect(secondInstall).rejects.toMatchObject({ code: "cancelled" }),
    ]);
    expect(mocks.cancelGoogleWorkspaceMcpAuth).toHaveBeenCalledWith({ setupId: SETUP_ID_A });
    expect(mocks.cancelGoogleWorkspaceMcpAuth).toHaveBeenCalledWith({ setupId: SETUP_ID_B });
    expect(mocks.createCloudMcpConnection).not.toHaveBeenCalled();
  });

  it("rejects non-Gmail local OAuth entries without calling storage dependencies", async () => {
    await expect(installLocalOAuthConnector(localOAuthCatalogEntry()))
      .rejects.toBeInstanceOf(LocalMcpOAuthError);
    await expect(installLocalOAuthConnector(localOAuthCatalogEntry()))
      .rejects.toMatchObject({ code: "process_failed" });

    expect(mocks.startGoogleWorkspaceMcpAuth).not.toHaveBeenCalled();
    expect(mocks.createCloudMcpConnection).not.toHaveBeenCalled();
  });

  it("marks local OAuth installed records broken for missing or invalid Gmail state", async () => {
    mocks.getGoogleWorkspaceMcpCredentialStatus.mockResolvedValueOnce({
      status: "not_ready",
      code: "credential_invalid",
    });

    const records = await augmentLocalOAuthInstalledStatus([
      installedGmailRecord(undefined),
      installedGmailRecord({ userGoogleEmail: "invalid@example.com" }),
      installedNonOAuthRecord(),
    ]);

    expect(records.map((record) => record.broken)).toEqual([true, true, false]);
    expect(mocks.getGoogleWorkspaceMcpCredentialStatus).toHaveBeenCalledTimes(1);
    expect(mocks.getGoogleWorkspaceMcpCredentialStatus).toHaveBeenCalledWith({
      userGoogleEmail: "invalid@example.com",
    });
  });

  it("marks local OAuth records broken when credential status lookup fails", async () => {
    mocks.getGoogleWorkspaceMcpCredentialStatus.mockRejectedValue(new Error("native failure"));

    const records = await augmentLocalOAuthInstalledStatus([
      installedGmailRecord({ userGoogleEmail: "user@example.com" }),
    ]);

    expect(records[0]?.broken).toBe(true);
  });

  it("reconnects Gmail with normalized saved state and reports completion after reconciliation", async () => {
    const reconcile = deferred<{ ok: true }>();
    let completed = false;
    mocks.reconcileGoogleWorkspaceMcpPendingSetups.mockReturnValue(reconcile.promise);

    const reconnectPromise = reconnectLocalOAuthConnector(
      gmailConnection({ settings: { userGoogleEmail: " User@Example.COM " } }),
      gmailCatalogEntry(),
    ).then((result) => {
      completed = true;
      return result;
    });

    expect(mocks.startGoogleWorkspaceMcpAuth).toHaveBeenCalledWith({
      setupId: SETUP_ID,
      userGoogleEmail: "user@example.com",
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
    });
    await vi.waitFor(() => {
      expect(mocks.reconcileGoogleWorkspaceMcpPendingSetups).toHaveBeenCalledWith({
        gmailConnections: [{
          connectionId: "conn_gmail",
          userGoogleEmail: "user@example.com",
        }],
      });
    });
    expect(completed).toBe(false);

    reconcile.resolve({ ok: true });

    await expect(reconnectPromise).resolves.toEqual({ kind: "completed" });
    expect(completed).toBe(true);
  });

  it("rejects reconnect when saved Gmail state is missing", async () => {
    await expect(
      reconnectLocalOAuthConnector(
        gmailConnection({ settings: {} }),
        gmailCatalogEntry(),
      ),
    ).rejects.toMatchObject({ code: "credential_invalid" });

    expect(mocks.startGoogleWorkspaceMcpAuth).not.toHaveBeenCalled();
  });

  it("rolls back reconnect completion when cancellation happens during reconciliation", async () => {
    const reconcile = deferred<{ ok: true }>();
    mocks.reconcileGoogleWorkspaceMcpPendingSetups.mockReturnValue(reconcile.promise);

    const reconnectPromise = reconnectLocalOAuthConnector(gmailConnection(), gmailCatalogEntry());
    await vi.waitFor(() => {
      expect(mocks.reconcileGoogleWorkspaceMcpPendingSetups).toHaveBeenCalled();
    });
    await cancelLocalOAuthConnectorConnect();
    reconcile.resolve({ ok: true });

    await expect(reconnectPromise).rejects.toMatchObject({ code: "cancelled" });
    expect(mocks.cancelGoogleWorkspaceMcpAuth).toHaveBeenCalledWith({ setupId: SETUP_ID });
  });

  it("surfaces retryable local data deletion failures before deleting cloud state", async () => {
    mocks.deleteGoogleWorkspaceMcpLocalData.mockResolvedValue({
      status: "retryable_failure",
      code: "cleanup_failed",
    });

    await expect(deleteLocalOAuthConnectorDataBeforeCloudDelete(gmailConnection()))
      .rejects.toMatchObject({ code: "cleanup_failed" });
    expect(mocks.deleteGoogleWorkspaceMcpLocalData).toHaveBeenCalledWith({
      connectionId: "conn_gmail",
      userGoogleEmail: "user@example.com",
    });
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

type AuthResult = { status: "completed"; userGoogleEmail: string };

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function gmailCatalogEntry(): ConnectorCatalogEntry {
  return {
    id: "gmail",
    name: "Gmail",
    oneLiner: "Gmail",
    description: "Gmail",
    docsUrl: "https://example.com",
    availability: "local_only",
    cloudSecretSync: false,
    setupKind: "local_oauth",
    transport: "stdio",
    command: "uvx",
    args: [],
    env: [
      { name: "GOOGLE_OAUTH_CLIENT_ID", source: { kind: "static", value: "client-id" } },
      { name: "GOOGLE_OAUTH_CLIENT_SECRET", source: { kind: "static", value: "client-secret" } },
    ],
    serverNameBase: "gmail",
    iconId: "gmail",
    displayUrl: "",
    secretFields: [],
    requiredFields: [],
    settingsSchema: [{
      id: "userGoogleEmail",
      kind: "string",
      label: "Google account email",
      placeholder: "name@example.com",
      helperText: "The Gmail account authorized on this desktop.",
      required: true,
      defaultValue: null,
      options: [],
      affectsUrl: false,
    }],
    capabilities: ["Search Gmail"],
  };
}

function localOAuthCatalogEntry(): ConnectorCatalogEntry {
  return {
    ...gmailCatalogEntry(),
    id: "calendar",
    name: "Calendar",
    serverNameBase: "calendar",
    iconId: "calendar",
  };
}

function gmailConnection(overrides: Partial<CloudMcpConnection> = {}): CloudMcpConnection {
  return {
    connectionId: "conn_gmail",
    catalogEntryId: "gmail",
    catalogEntryVersion: 1,
    serverName: "gmail",
    enabled: true,
    settings: { userGoogleEmail: "user@example.com" },
    authKind: "none",
    authStatus: "ready",
    configVersion: 1,
    authVersion: null,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

function installedGmailRecord(
  settings: InstalledConnectorRecord["metadata"]["settings"],
): InstalledConnectorRecord {
  return {
    metadata: {
      connectionId: "conn_gmail",
      catalogEntryId: "gmail",
      enabled: true,
      serverName: "gmail",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
      lastSyncedAt: null,
      settings,
    },
    catalogEntry: gmailCatalogEntry(),
    broken: false,
  };
}

function installedNonOAuthRecord(): InstalledConnectorRecord {
  return {
    metadata: {
      connectionId: "conn_context7",
      catalogEntryId: "context7",
      enabled: true,
      serverName: "context7",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
      lastSyncedAt: null,
      settings: undefined,
    },
    catalogEntry: {
      ...gmailCatalogEntry(),
      id: "context7",
      name: "Context7",
      setupKind: "none",
      serverNameBase: "context7",
      iconId: "context7",
      settingsSchema: [],
    },
    broken: false,
  };
}
