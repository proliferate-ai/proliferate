// @vitest-environment jsdom

import type { TerminalRecord } from "@anyharness/sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalStreamIdentity } from "@/lib/infra/terminals/terminal-stream-registry";

const h = vi.hoisted(() => ({
  connectionVersion: 0,
  identity: null as TerminalStreamIdentity | null,
  ensureTabConnection: vi.fn(),
  resizeTab: vi.fn(),
  sendInput: vi.fn(),
  sendResize: vi.fn(),
  subscribeWithReplay: vi.fn(),
  terminal: { write: vi.fn() },
  terminalRef: { current: null as null | { write: ReturnType<typeof vi.fn> } },
  onData: null as null | ((data: string) => void),
}));

vi.mock("@/hooks/terminals/workflows/use-terminal-actions", () => ({
  useTerminalActions: () => ({ resizeTab: h.resizeTab }),
}));

vi.mock("@/hooks/terminals/lifecycle/use-terminal-stream-controller", () => ({
  useTerminalStreamController: () => ({
    ensureTabConnection: h.ensureTabConnection,
  }),
}));

vi.mock("@/hooks/terminals/lifecycle/use-xterm-surface", () => ({
  useXtermSurface: (options: { onData: (data: string) => void }) => {
    h.onData = options.onData;
    return {
      containerRef: { current: null },
      isReady: true,
      terminalRef: h.terminalRef,
    };
  },
}));

vi.mock("@/lib/infra/terminals/terminal-stream-registry", () => ({
  sendInput: h.sendInput,
  sendResize: h.sendResize,
  subscribeWithReplay: h.subscribeWithReplay,
}));

vi.mock("@/stores/terminal/terminal-store", () => ({
  useTerminalStore: (selector: (state: {
    connectionVersionByTerminal: Record<string, number>;
  }) => unknown) => selector({
    connectionVersionByTerminal: { "terminal-1": h.connectionVersion },
  }),
}));

import { useTerminalViewport } from "./use-terminal-viewport";

const TERMINAL = {
  id: "terminal-1",
  status: "running",
} as TerminalRecord;

const AUTHORITY_A: TerminalStreamIdentity = {
  workspaceId: "cloud:workspace-1",
  terminalId: "terminal-1",
  runtimeIdentity: "https://runtime.test\u0000workspace-1\u00001",
  cloudAuthorityScopeKey: "authority-a",
};

const AUTHORITY_B: TerminalStreamIdentity = {
  ...AUTHORITY_A,
  cloudAuthorityScopeKey: "authority-b",
};

describe("useTerminalViewport cloud stream authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.connectionVersion = 0;
    h.identity = AUTHORITY_A;
    h.terminalRef.current = h.terminal;
    h.onData = null;
    h.ensureTabConnection.mockImplementation(async () => h.identity);
    h.subscribeWithReplay.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    cleanup();
  });

  it("rebinds replay and input when cloud authority changes at the same runtime", async () => {
    const firstUnsubscribe = vi.fn();
    const secondUnsubscribe = vi.fn();
    h.subscribeWithReplay
      .mockReturnValueOnce(firstUnsubscribe)
      .mockReturnValueOnce(secondUnsubscribe);

    const rendered = renderHook(() => useTerminalViewport({
      terminal: TERMINAL,
      workspaceId: "cloud:workspace-1",
      visible: true,
      canConnect: true,
      focusRequestToken: 0,
    }));
    await waitFor(() => expect(h.subscribeWithReplay).toHaveBeenCalledTimes(1));
    expect(h.subscribeWithReplay).toHaveBeenNthCalledWith(
      1,
      AUTHORITY_A,
      expect.any(Function),
    );

    h.identity = AUTHORITY_B;
    h.connectionVersion = 1;
    rendered.rerender();

    await waitFor(() => expect(h.subscribeWithReplay).toHaveBeenCalledTimes(2));
    expect(firstUnsubscribe).toHaveBeenCalledOnce();
    expect(h.subscribeWithReplay).toHaveBeenNthCalledWith(
      2,
      AUTHORITY_B,
      expect.any(Function),
    );

    const replayListener = h.subscribeWithReplay.mock.calls[1]?.[1];
    replayListener?.({
      type: "data",
      order: 1,
      seq: 1,
      data: new Uint8Array([65]),
    });
    expect(h.terminal.write).toHaveBeenCalledWith(new Uint8Array([65]));

    h.onData?.("pwd\n");
    expect(h.sendInput).toHaveBeenCalledWith(AUTHORITY_B, "pwd\n");
  });
});
