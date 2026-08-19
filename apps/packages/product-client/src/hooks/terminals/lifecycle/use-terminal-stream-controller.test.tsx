// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { connectTerminal } from "@anyharness/sdk";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { resetTerminalStreamRegistryForTests } from "#product/lib/infra/terminals/terminal-stream-registry";
import { useTerminalStreamController } from "#product/hooks/terminals/lifecycle/use-terminal-stream-controller";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { resetRendererFlowsForTest } from "#product/lib/infra/diagnostics/renderer-flow-timing";

const mockState = vi.hoisted(() => ({
  token: "token-a",
  runtimeGeneration: 3,
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

const testProductHost = { desktop: null, cloud: { client: null } } as ProductHost;

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

vi.mock("#product/hooks/access/cloud/query-keys", () => ({
  cloudWorkspaceConnectionKey: (workspaceId: string) => [
    "cloud",
    "workspaces",
    workspaceId,
    "connection",
  ],
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    selectedCloudRuntime: {
      workspaceId: null,
      state: null,
      connectionInfo: null,
    },
    getWorkspaceRuntimeBlockReason: vi.fn(() => null),
  }),
}));

vi.mock("#product/lib/access/anyharness/resolve-workspace-connection", () => ({
  resolveWorkspaceConnection: vi.fn(async () => ({
    connection: {
      runtimeUrl: "http://runtime.test",
      authToken: mockState.token,
      anyharnessWorkspaceId: "anyharness-workspace-1",
      runtimeGeneration: mockState.runtimeGeneration,
      runtimeAccessKind: "direct",
    },
    filesystemOrigin: "desktop-local",
  })),
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => {
  const state = {
    runtimeUrl: "http://desktop-runtime.test",
  };
  const useHarnessConnectionStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return { useHarnessConnectionStore };
});

vi.mock("#product/stores/sessions/session-selection-store", () => {
  const state = {
    selectedWorkspaceId: "workspace-1",
  };
  const useSessionSelectionStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return { useSessionSelectionStore };
});

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (value: { show: (message: string) => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

vi.mock("#product/stores/terminal/terminal-store", () => {
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
    mockState.connections = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    resetTerminalStreamRegistryForTests();
  });

  describe("renderer flow marks", () => {
    let emitted: RendererDiagnosticInput[];

    beforeEach(() => {
      emitted = [];
      setRendererDiagnosticsSink({ emit: (input) => emitted.push(input) });
      resetRendererFlowsForTest();
    });

    afterEach(() => {
      resetRendererDiagnosticsSinkForTest();
      resetRendererFlowsForTest();
    });

    it("emits shell_committed on a fresh attach but NOT on a keep-alive reattach onto an exited entry", async () => {
      const { result } = renderActions();

      // First attach: connects normally, marks shell_committed once.
      const identity = await result.current.ensureTabConnection(
        "terminal-1",
        "workspace-1",
        "exited",
      );
      const shellCommittedAfterFirstAttach = emitted.filter(
        (entry) => entry.name === "renderer.flow.shell_committed",
      );
      expect(shellCommittedAfterFirstAttach).toHaveLength(1);

      // Stream closes without an explicit exit event: the readOnlyReplay
      // onClose handler marks the registry entry exited, clearing its handle.
      mockState.connections[0]!.options.onClose?.(new Event("close") as CloseEvent);

      // Second call: hasActiveHandle is now false (handle cleared), so this
      // reaches attachTerminalStream again. But the entry is marked
      // `exited`, so ensureConnected returns didConnect === false (a
      // keep-alive reattach onto a dead entry). This must abandon the flow
      // with reason "already_connected" and must NOT add another
      // shell_committed sample (that would contaminate terminal_attach
      // aggregations with a spurious near-0ms reading).
      const secondIdentity = await result.current.ensureTabConnection(
        "terminal-1",
        "workspace-1",
        "exited",
      );
      expect(secondIdentity).toEqual(identity);

      const shellCommittedAfterReattach = emitted.filter(
        (entry) => entry.name === "renderer.flow.shell_committed",
      );
      expect(shellCommittedAfterReattach).toHaveLength(1);

      const abandoned = emitted.filter((entry) => entry.name === "renderer.flow.abandoned");
      expect(abandoned).toHaveLength(1);
      expect(
        Object.fromEntries(
          Object.entries(abandoned[0]!.fields ?? {}).map(([key, field]) => [key, field.value]),
        ),
      ).toMatchObject({ reason: "already_connected" });
    });
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

function renderActions() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ProductHostProvider host={testProductHost}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ProductHostProvider>
  );
  return renderHook(() => useTerminalStreamController(), { wrapper });
}
