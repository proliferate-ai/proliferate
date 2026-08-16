// @vitest-environment jsdom

import type { TerminalRecord } from "@anyharness/sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureConnected,
  resetTerminalStreamRegistryForTests,
  type TerminalStreamIdentity,
} from "#product/lib/infra/terminals/terminal-stream-registry";
import { useTerminalViewport } from "#product/hooks/terminals/lifecycle/use-terminal-viewport";
import { useTerminalStore } from "#product/stores/terminal/terminal-store";

// Drive Q13 ordering: the connection resolves at pane-activation intent (visible)
// rather than at xterm mount, the registry buffers replay bytes in the interim,
// and the surface drains that buffer in order once it mounts.

interface CapturedConnection {
  options: {
    onData?: (
      data: Uint8Array,
      frame: { type: "data"; seq: number; terminalId: string; dataBase64: string },
    ) => void;
  };
}

const connections = vi.hoisted(() => [] as CapturedConnection[]);

vi.mock("@anyharness/sdk", () => ({
  connectTerminal: vi.fn((options) => {
    const handle = { send: vi.fn(), sendResize: vi.fn(), close: vi.fn() };
    connections.push({ options });
    return handle;
  }),
}));

// Controllable xterm surface: `surfaceReady` flips mount readiness, and the fake
// terminal records every `write` so we can assert replay order.
const surface = vi.hoisted(() => ({
  ready: false,
  writes: [] as string[],
}));

const fakeTerminal = {
  write: vi.fn((data: string | Uint8Array) => {
    surface.writes.push(
      typeof data === "string" ? data : new TextDecoder().decode(data),
    );
  }),
};

const terminalRef = { current: fakeTerminal };

vi.mock("#product/hooks/terminals/lifecycle/use-xterm-surface", () => ({
  useXtermSurface: () => ({
    containerRef: { current: null },
    isReady: surface.ready,
    terminalRef,
  }),
}));

vi.mock("#product/hooks/terminals/workflows/use-terminal-actions", () => ({
  useTerminalActions: () => ({ resizeTab: vi.fn() }),
}));

// ensureTabConnection is deferred so a test can resolve activation intent
// mid-connect; when a deferred resolves, the matching stream is already opened
// in the real registry so its buffer exists.
const pending = vi.hoisted(
  () => [] as Array<{
    resolve: (identity: TerminalStreamIdentity | null) => void;
  }>,
);
const ensureTabConnection = vi.hoisted(() =>
  vi.fn(
    () =>
      new Promise<TerminalStreamIdentity | null>((resolve) => {
        pending.push({ resolve });
      }),
  ),
);

vi.mock("#product/hooks/terminals/lifecycle/use-terminal-stream-controller", () => ({
  useTerminalStreamController: () => ({ ensureTabConnection }),
}));

const terminal: TerminalRecord = {
  id: "terminal-1",
  status: "running",
} as TerminalRecord;

function openStream(runtimeGeneration: number): {
  identity: TerminalStreamIdentity;
  feed: (bytes: number[], seq: number) => void;
} {
  const identity: TerminalStreamIdentity = {
    workspaceId: "workspace-1",
    terminalId: "terminal-1",
    runtimeIdentity: `http://runtime.test-gen-${runtimeGeneration}`,
  };
  ensureConnected({ identity, baseUrl: "http://runtime.test" });
  const connection = connections[connections.length - 1]!;
  return {
    identity,
    feed: (bytes, seq) => {
      connection.options.onData?.(new Uint8Array(bytes), {
        type: "data",
        seq,
        terminalId: "terminal-1",
        dataBase64: "",
      });
    },
  };
}

function renderViewport() {
  return renderHook(() =>
    useTerminalViewport({
      terminal,
      workspaceId: "workspace-1",
      visible: true,
      canConnect: true,
      focusRequestToken: 0,
    }),
  );
}

describe("useTerminalViewport Q13 attach ordering", () => {
  beforeEach(() => {
    resetTerminalStreamRegistryForTests();
    connections.length = 0;
    pending.length = 0;
    surface.ready = false;
    surface.writes.length = 0;
    fakeTerminal.write.mockClear();
    ensureTabConnection.mockClear();
    useTerminalStore.setState({ connectionVersionByTerminal: {} });
  });

  afterEach(() => {
    cleanup();
    resetTerminalStreamRegistryForTests();
  });

  it("starts connection at activation intent before the surface is mounted", () => {
    renderViewport();
    // Surface is not ready (isReady === false) yet the connection has already
    // been requested at pane-activation intent.
    expect(surface.ready).toBe(false);
    expect(ensureTabConnection).toHaveBeenCalledTimes(1);
  });

  it("drains pre-mount buffered bytes in order once the surface mounts", async () => {
    const { rerender } = renderViewport();

    // Connection resolves and buffers bytes while the surface is still mounting.
    const stream = openStream(1);
    await act(async () => {
      pending[0]!.resolve(stream.identity);
    });
    stream.feed([65], 1); // "A"
    stream.feed([66], 2); // "B"
    expect(surface.writes).toEqual([]);

    // Surface mounts -> buffered replay drains in arrival order.
    surface.ready = true;
    await act(async () => {
      rerender();
    });
    expect(surface.writes).toEqual(["A", "B"]);

    // Live bytes after mount keep streaming in order.
    stream.feed([67], 3); // "C"
    expect(surface.writes).toEqual(["A", "B", "C"]);
  });

  it("does not cross-wire a stale buffer when the pane re-resolves mid-connect", async () => {
    const { rerender } = renderViewport();
    surface.ready = true;
    await act(async () => {
      rerender();
    });

    // First activation (stale) opens stream gen-1 and buffers "X".
    const stale = openStream(1);
    stale.feed([88], 1); // "X"

    // A connection-version bump re-runs activation; the stale resolution must be
    // dropped by the cancelled guard.
    await act(async () => {
      useTerminalStore.getState().bumpConnectionVersion("terminal-1");
    });

    // Second activation opens stream gen-2 and buffers "Y".
    const fresh = openStream(2);
    fresh.feed([89], 1); // "Y"

    await act(async () => {
      pending[0]!.resolve(stale.identity); // stale resolves late; must be ignored
    });
    await act(async () => {
      pending[1]!.resolve(fresh.identity);
    });

    expect(surface.writes).toEqual(["Y"]);
    expect(surface.writes).not.toContain("X");
  });
});
