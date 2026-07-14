// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { connectTerminal } from "@anyharness/sdk";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { resetTerminalStreamRegistryForTests } from "@/lib/infra/terminals/terminal-stream-registry";
import { resolveWorkspaceConnection } from "@/lib/access/anyharness/resolve-workspace-connection";
import { useTerminalStreamAuthorityLifecycle } from "./use-terminal-stream-authority-lifecycle";
import { useTerminalStreamController } from "./use-terminal-stream-controller";

const mockState = vi.hoisted(() => ({
  token: "token-a",
  runtimeGeneration: 3,
  selectedCloudRuntime: {
    workspaceId: null as string | null,
    state: null as { phase: "ready" } | null,
    connectionInfo: null as {
      runtimeUrl: string;
      accessToken: string;
      anyharnessWorkspaceId: string;
      runtimeGeneration: number;
    } | null,
  },
  connections: [] as Array<{
    options: {
      afterSeq?: number;
      onData?: (
        data: Uint8Array,
        frame: {
          type: "data";
          seq: number;
          terminalId: string;
          dataBase64: string;
        },
      ) => void;
      onExit?: (code: number | null) => void;
      onClose?: (event: CloseEvent) => void;
    };
    handle: {
      send: ReturnType<typeof vi.fn>;
      sendResize: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
  }>,
}));

const testProductHost = {
  deployment: { apiBaseUrl: "https://api.test" },
  auth: {
    state: {
      status: "authenticated",
      user: { id: "user-1" },
      readiness: { status: "ready" },
    },
  },
  cloud: { client: {} },
  desktop: null,
} as ProductHost;

vi.mock("@anyharness/sdk", () => ({
  AnyHarnessError: class AnyHarnessError extends Error {
    problem = { status: 500, code: "UNKNOWN" };
  },
  connectTerminal: vi.fn((options) => {
    const handle = {
      send: vi.fn(),
      sendResize: vi.fn(),
      close: vi.fn(),
    };
    mockState.connections.push({ options, handle });
    return handle;
  }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  anyHarnessTerminalsKey: (cacheScopeKey: string, workspaceId: string) => [
    "terminals",
    cacheScopeKey,
    workspaceId,
  ],
  getAnyHarnessClient: vi.fn(),
  useAnyHarnessCacheScopeKey: () => "test-cache-scope",
}));

vi.mock("@/hooks/access/cloud/query-keys", () => ({
  cloudWorkspaceConnectionKey: (workspaceId: string) => [
    "cloud",
    "workspaces",
    workspaceId,
    "connection",
  ],
  cloudWorkspaceConnectionAuthorityKey: (
    workspaceId: string,
    authorityScopeKey: string,
  ) => ["cloud", "workspaces", workspaceId, "connection", "authority", authorityScopeKey],
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    selectedCloudRuntime: mockState.selectedCloudRuntime,
    getWorkspaceRuntimeBlockReason: vi.fn(() => null),
  }),
}));

vi.mock("@/lib/access/anyharness/resolve-workspace-connection", () => ({
  resolveWorkspaceConnection: vi.fn(async (
    _runtimeUrl: string,
    workspaceId: string,
    _ssh: unknown,
    cloudClient: unknown,
  ) => {
    if (workspaceId.startsWith("cloud:") && !cloudClient) {
      throw new Error("Cloud workspace access is unavailable for this host.");
    }
    return {
      runtimeUrl: "http://runtime.test",
      authToken: mockState.token,
      anyharnessWorkspaceId: "anyharness-workspace-1",
      runtimeGeneration: mockState.runtimeGeneration,
    };
  }),
}));

vi.mock("@/stores/sessions/harness-connection-store", () => {
  const state = {
    runtimeUrl: "http://desktop-runtime.test",
  };
  const useHarnessConnectionStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return { useHarnessConnectionStore };
});

vi.mock("@/stores/sessions/session-selection-store", () => {
  const state = {
    selectedWorkspaceId: "workspace-1",
  };
  const useSessionSelectionStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return { useSessionSelectionStore };
});

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (value: { show: (message: string) => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

vi.mock("@/stores/terminal/terminal-store", () => {
  const state = {
    activeTerminalByWorkspace: { "workspace-1": "terminal-1" },
    markUnread: vi.fn(),
    clearTerminalState: vi.fn(),
    bumpConnectionVersion: vi.fn(),
  };
  const useTerminalStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return { useTerminalStore };
});

describe("useTerminalStreamController terminal stream identity", () => {
  beforeEach(() => {
    resetTerminalStreamRegistryForTests();
    mockState.token = "token-a";
    mockState.runtimeGeneration = 3;
    mockState.selectedCloudRuntime = {
      workspaceId: null,
      state: null,
      connectionInfo: null,
    };
    mockState.connections = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    resetTerminalStreamRegistryForTests();
  });

  it("keeps an active stream identity stable across credential refreshes", async () => {
    const { result } = renderActions();

    const firstIdentity = await result.current.ensureTabConnection(
      "terminal-1",
      "workspace-1",
      "running",
    );
    mockState.token = "token-b";
    const secondIdentity = await result.current.ensureTabConnection(
      "terminal-1",
      "workspace-1",
      "running",
    );

    expect(firstIdentity).toEqual(secondIdentity);
    expect(connectTerminal).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a selected cloud connection after host authority is removed", async () => {
    mockState.selectedCloudRuntime = {
      workspaceId: "cloud:workspace-1",
      state: { phase: "ready" },
      connectionInfo: {
        runtimeUrl: "http://stale-runtime.test",
        accessToken: "stale-token",
        anyharnessWorkspaceId: "stale-workspace",
        runtimeGeneration: 1,
      },
    };
    const nullAuthorityHost = {
      ...testProductHost,
      cloud: { client: null },
    } as ProductHost;
    const { result } = renderActions(nullAuthorityHost);

    await expect(result.current.ensureTabConnection(
      "terminal-1",
      "cloud:workspace-1",
      "running",
    )).rejects.toThrow("Cloud workspace access is unavailable for this host.");

    expect(resolveWorkspaceConnection).toHaveBeenCalledWith(
      "http://desktop-runtime.test",
      "cloud:workspace-1",
      null,
      null,
    );
  });

  it("retires and replaces an active cloud stream when host authority changes", async () => {
    mockState.selectedCloudRuntime = readySelectedCloudRuntime();
    const cloudClientA = testCloudClient();
    const cloudClientB = testCloudClient();
    const rendered = renderActions(productHostWithCloudClient(cloudClientA, "user-a"));

    const firstIdentity = await rendered.result.current.ensureTabConnection(
      "terminal-1",
      "cloud:workspace-1",
      "running",
    );
    rendered.replaceHost(productHostWithCloudClient(cloudClientB, "user-a"));

    expect(mockState.connections[0]!.handle.close).toHaveBeenCalledTimes(1);

    const secondIdentity = await rendered.result.current.ensureTabConnection(
      "terminal-1",
      "cloud:workspace-1",
      "running",
    );

    expect(firstIdentity?.runtimeIdentity).toBe(secondIdentity?.runtimeIdentity);
    expect(firstIdentity?.cloudAuthorityScopeKey).not.toBe(
      secondIdentity?.cloudAuthorityScopeKey,
    );
    expect(connectTerminal).toHaveBeenCalledTimes(2);
  });

  it("discards a pending cloud resolution when host authority changes", async () => {
    const cloudClientA = testCloudClient();
    const cloudClientB = testCloudClient();
    type ResolvedConnection = Awaited<ReturnType<typeof resolveWorkspaceConnection>>;
    let finishResolution!: (connection: ResolvedConnection) => void;
    const pendingResolution = new Promise<ResolvedConnection>((resolve) => {
      finishResolution = resolve;
    });
    vi.mocked(resolveWorkspaceConnection).mockImplementationOnce(
      () => pendingResolution,
    );
    const rendered = renderActions(productHostWithCloudClient(cloudClientA, "user-a"));

    const staleAttempt = rendered.result.current.ensureTabConnection(
      "terminal-1",
      "cloud:workspace-1",
      "running",
    );
    rendered.replaceHost(productHostWithCloudClient(cloudClientB, "user-a"));
    finishResolution({
      runtimeUrl: "http://authority-a-runtime.test",
      authToken: "authority-a-token",
      anyharnessWorkspaceId: "anyharness-workspace-1",
      runtimeGeneration: 1,
    });

    await expect(staleAttempt).resolves.toBeNull();
    expect(connectTerminal).not.toHaveBeenCalled();

    const currentIdentity = await rendered.result.current.ensureTabConnection(
      "terminal-1",
      "cloud:workspace-1",
      "running",
    );
    expect(currentIdentity?.cloudAuthorityScopeKey).toBeDefined();
    expect(connectTerminal).toHaveBeenCalledTimes(1);
    expect(resolveWorkspaceConnection).toHaveBeenLastCalledWith(
      "http://desktop-runtime.test",
      "cloud:workspace-1",
      null,
      cloudClientB,
    );
  });

  it("retires an active cloud stream when host authority disappears", async () => {
    mockState.selectedCloudRuntime = readySelectedCloudRuntime();
    const rendered = renderActions(productHostWithCloudClient(testCloudClient(), "user-a"));

    await rendered.result.current.ensureTabConnection(
      "terminal-1",
      "cloud:workspace-1",
      "running",
    );
    rendered.replaceHost(productHostWithCloudClient(null, "user-a"));

    expect(mockState.connections[0]!.handle.close).toHaveBeenCalledTimes(1);
    await expect(rendered.result.current.ensureTabConnection(
      "terminal-1",
      "cloud:workspace-1",
      "running",
    )).rejects.toThrow("Cloud workspace access is unavailable for this host.");
    expect(connectTerminal).toHaveBeenCalledTimes(1);
  });

  it("reconnects after credential refresh with the previous data seq", async () => {
    const { result } = renderActions();

    const firstIdentity = await result.current.ensureTabConnection(
      "terminal-1",
      "workspace-1",
      "running",
    );
    mockState.connections[0]!.options.onData?.(new Uint8Array([1]), {
      type: "data",
      seq: 9,
      terminalId: "terminal-1",
      dataBase64: "",
    });
    mockState.connections[0]!.options.onClose?.(new Event("close") as CloseEvent);
    mockState.token = "token-b";
    const secondIdentity = await result.current.ensureTabConnection(
      "terminal-1",
      "workspace-1",
      "running",
    );

    expect(firstIdentity).toEqual(secondIdentity);
    expect(connectTerminal).toHaveBeenCalledTimes(2);
    expect(mockState.connections[1]!.options.afterSeq).toBe(9);
  });

  it("retires the previous active stream when runtime identity changes", async () => {
    const { result } = renderActions();

    const firstIdentity = await result.current.ensureTabConnection(
      "terminal-1",
      "workspace-1",
      "running",
    );
    mockState.runtimeGeneration = 4;
    const secondIdentity = await result.current.ensureTabConnection(
      "terminal-1",
      "workspace-1",
      "running",
    );

    expect(firstIdentity?.runtimeIdentity).toBe("http://runtime.test\u0000anyharness-workspace-1\u00003");
    expect(secondIdentity?.runtimeIdentity).toBe("http://runtime.test\u0000anyharness-workspace-1\u00004");
    expect(connectTerminal).toHaveBeenCalledTimes(2);
    expect(mockState.connections[0]!.handle.close).toHaveBeenCalledTimes(1);
  });

  it("opens a read-only replay stream for exited terminals", async () => {
    const { result } = renderActions();

    const identity = await result.current.ensureTabConnection(
      "terminal-1",
      "workspace-1",
      "exited",
    );

    expect(identity).toEqual({
      workspaceId: "workspace-1",
      terminalId: "terminal-1",
      runtimeIdentity: "http://runtime.test\u0000anyharness-workspace-1\u00003",
    });
    expect(connectTerminal).toHaveBeenCalledTimes(1);
    expect(mockState.connections[0]!.options.afterSeq).toBeUndefined();

    mockState.connections[0]!.options.onData?.(new Uint8Array([1]), {
      type: "data",
      seq: 4,
      terminalId: "terminal-1",
      dataBase64: "",
    });
    mockState.connections[0]!.options.onExit?.(0);

    const replayedIdentity = await result.current.ensureTabConnection(
      "terminal-1",
      "workspace-1",
      "exited",
    );

    expect(replayedIdentity).toEqual(identity);
    expect(connectTerminal).toHaveBeenCalledTimes(1);
  });

  it("does not loop replay-only reconnects when an exited terminal stream closes without exit", async () => {
    const { result } = renderActions();

    const identity = await result.current.ensureTabConnection(
      "terminal-1",
      "workspace-1",
      "exited",
    );
    mockState.connections[0]!.options.onClose?.(new Event("close") as CloseEvent);

    const secondIdentity = await result.current.ensureTabConnection(
      "terminal-1",
      "workspace-1",
      "exited",
    );

    expect(secondIdentity).toEqual(identity);
    expect(connectTerminal).toHaveBeenCalledTimes(1);
  });
});

function renderActions(host: ProductHost = testProductHost) {
  let currentHost = host;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ProductHostProvider host={currentHost}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ProductHostProvider>
  );
  const rendered = renderHook(() => {
    useTerminalStreamAuthorityLifecycle();
    return useTerminalStreamController();
  }, { wrapper });

  return Object.assign(rendered, {
    replaceHost(nextHost: ProductHost) {
      currentHost = nextHost;
      rendered.rerender();
    },
  });
}

function readySelectedCloudRuntime() {
  return {
    workspaceId: "cloud:workspace-1",
    state: { phase: "ready" as const },
    connectionInfo: {
      runtimeUrl: "http://runtime.test",
      accessToken: mockState.token,
      anyharnessWorkspaceId: "anyharness-workspace-1",
      runtimeGeneration: mockState.runtimeGeneration,
    },
  };
}

function productHostWithCloudClient(
  client: ProductHost["cloud"]["client"],
  userId: string,
): ProductHost {
  return {
    ...testProductHost,
    auth: {
      ...testProductHost.auth,
      state: {
        status: "authenticated",
        user: { id: userId },
        readiness: { status: "ready" },
      },
    },
    cloud: { client },
  };
}

function testCloudClient(): NonNullable<ProductHost["cloud"]["client"]> {
  return {} as NonNullable<ProductHost["cloud"]["client"]>;
}
