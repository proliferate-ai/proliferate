// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { connectTerminal } from "@anyharness/sdk";
import { resetTerminalStreamRegistryForTests } from "@/lib/integrations/anyharness/terminal-handles";
import { useTerminalActions } from "./use-terminal-actions";

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
  anyHarnessTerminalsKey: (runtimeUrl: string, workspaceId: string) => [
    "terminals",
    runtimeUrl,
    workspaceId,
  ],
  getAnyHarnessClient: vi.fn(),
}));

vi.mock("@/hooks/cloud/query-keys", () => ({
  cloudWorkspaceConnectionKey: (workspaceId: string) => [
    "cloud",
    "workspaces",
    workspaceId,
    "connection",
  ],
}));

vi.mock("@/hooks/workspaces/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    selectedCloudRuntime: {
      workspaceId: null,
      state: null,
      connectionInfo: null,
    },
    getWorkspaceRuntimeBlockReason: vi.fn(() => null),
  }),
}));

vi.mock("@/lib/integrations/anyharness/resolve-workspace-connection", () => ({
  resolveWorkspaceConnection: vi.fn(async () => ({
    runtimeUrl: "http://runtime.test",
    authToken: mockState.token,
    anyharnessWorkspaceId: "anyharness-workspace-1",
    runtimeGeneration: mockState.runtimeGeneration,
  })),
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

describe("useTerminalActions terminal stream identity", () => {
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
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTerminalActions(), { wrapper });
}
