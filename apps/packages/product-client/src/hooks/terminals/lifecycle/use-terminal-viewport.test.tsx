// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalRecord } from "@anyharness/sdk";
import { useTerminalViewport } from "#product/hooks/terminals/lifecycle/use-terminal-viewport";
import type {
  TerminalStreamIdentity,
} from "#product/lib/infra/terminals/terminal-stream-registry";
import type { TerminalReplayEntry } from "#product/lib/infra/terminals/terminal-replay-buffer";

const mockState = vi.hoisted(() => ({
  ensureTabConnection: vi.fn(),
  resizeTab: vi.fn(),
  subscriptions: [] as Array<{
    listener: (entry: TerminalReplayEntry) => void;
    options: { afterOrder?: number };
    unsubscribe: ReturnType<typeof vi.fn>;
  }>,
  writers: [] as Array<{
    enqueue: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onFlush?: (entries: readonly TerminalReplayEntry[]) => void;
  }>,
  terminal: { write: vi.fn() },
}));

vi.mock("#product/hooks/terminals/workflows/use-terminal-actions", () => ({
  useTerminalActions: () => ({ resizeTab: mockState.resizeTab }),
}));

vi.mock("#product/hooks/terminals/lifecycle/use-terminal-stream-controller", () => ({
  useTerminalStreamController: () => ({
    ensureTabConnection: mockState.ensureTabConnection,
  }),
}));

vi.mock("#product/hooks/terminals/lifecycle/use-xterm-surface", () => ({
  useXtermSurface: () => ({
    containerRef: { current: null },
    isReady: true,
    terminalRef: { current: mockState.terminal },
  }),
}));

vi.mock("#product/lib/infra/terminals/terminal-stream-registry", () => ({
  sendInput: vi.fn(),
  sendResize: vi.fn(),
  subscribeWithReplay: vi.fn((
    _identity: TerminalStreamIdentity,
    listener: (entry: TerminalReplayEntry) => void,
    options: { afterOrder?: number },
  ) => {
    const subscription = { listener, options, unsubscribe: vi.fn() };
    mockState.subscriptions.push(subscription);
    return subscription.unsubscribe;
  }),
}));

vi.mock("#product/lib/infra/terminals/terminal-replay-writer", () => ({
  createTerminalReplayWriter: vi.fn((
    _terminal: unknown,
    _scheduler: unknown,
    onFlush?: (entries: readonly TerminalReplayEntry[]) => void,
  ) => {
    const writer = { enqueue: vi.fn(), dispose: vi.fn(), onFlush };
    mockState.writers.push(writer);
    return writer;
  }),
}));

vi.mock("#product/lib/infra/terminals/terminal-stream-key", () => ({
  terminalStreamKey: (identity: TerminalStreamIdentity) =>
    `${identity.workspaceId}:${identity.terminalId}:${identity.runtimeIdentity}`,
}));

vi.mock("#product/stores/terminal/terminal-store", () => ({
  useTerminalStore: (selector: (state: {
    connectionVersionByTerminal: Record<string, number>;
  }) => unknown) => selector({ connectionVersionByTerminal: {} }),
}));

const identity: TerminalStreamIdentity = {
  workspaceId: "workspace-1",
  terminalId: "terminal-1",
  runtimeIdentity: "runtime-1",
};

describe("useTerminalViewport output rendering", () => {
  beforeEach(() => {
    mockState.ensureTabConnection.mockResolvedValue(identity);
    mockState.subscriptions = [];
    mockState.writers = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("pauses hidden rendering and resumes after the last flushed order", async () => {
    const rendered = renderHook(
      ({ visible }) => useTerminalViewport({
        terminal: terminalRecord(),
        workspaceId: "workspace-1",
        visible,
        canConnect: true,
        focusRequestToken: 0,
      }),
      { initialProps: { visible: true } },
    );

    await waitFor(() => expect(mockState.subscriptions).toHaveLength(1));
    expect(mockState.subscriptions[0]?.options).toEqual({ afterOrder: 0 });

    const firstEntry = dataEntry(1, "one");
    mockState.subscriptions[0]?.listener(firstEntry);
    expect(mockState.writers[0]?.enqueue).toHaveBeenCalledWith(firstEntry);
    mockState.writers[0]?.onFlush?.([firstEntry]);

    rendered.rerender({ visible: false });
    expect(mockState.subscriptions[0]?.unsubscribe).toHaveBeenCalledOnce();
    expect(mockState.writers[0]?.dispose).toHaveBeenCalledOnce();

    rendered.rerender({ visible: true });
    await waitFor(() => expect(mockState.subscriptions).toHaveLength(2));
    expect(mockState.subscriptions[1]?.options).toEqual({ afterOrder: 1 });

    const queuedEntry = dataEntry(2, "queued");
    mockState.subscriptions[1]?.listener(queuedEntry);
    rendered.rerender({ visible: false });
    rendered.rerender({ visible: true });
    await waitFor(() => expect(mockState.subscriptions).toHaveLength(3));
    expect(mockState.subscriptions[2]?.options).toEqual({ afterOrder: 1 });
  });
});

function terminalRecord(): TerminalRecord {
  return {
    commandRun: null,
    createdAt: "2026-01-01T00:00:00Z",
    cwd: "/workspace",
    id: "terminal-1",
    purpose: "general",
    status: "running",
    title: "Terminal",
    updatedAt: "2026-01-01T00:00:00Z",
    workspaceId: "workspace-1",
  };
}

function dataEntry(order: number, value: string): TerminalReplayEntry {
  return {
    type: "data",
    order,
    seq: order,
    data: new TextEncoder().encode(value),
  };
}
