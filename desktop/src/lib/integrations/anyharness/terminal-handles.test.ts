import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectTerminal } from "@anyharness/sdk";
import {
  adoptTerminalStreamIdentity,
  clearForRuntime,
  clearTerminal,
  createTerminalRuntimeIdentity,
  ensureConnected,
  getLastDataSeq,
  hasActiveHandle,
  markReadOnly,
  resetTerminalStreamRegistryForTests,
  sendInput,
  sendResize,
  subscribeWithReplay,
  type TerminalReplayEntry,
  type TerminalStreamIdentity,
} from "./terminal-handles";

const mockState = vi.hoisted(() => ({
  connections: [] as Array<{
    options: {
      afterSeq?: number;
      onData?: (data: Uint8Array, frame: { type: "data"; seq: number; terminalId: string; dataBase64: string }) => void;
      onExit?: (code: number | null) => void;
      onReplayGap?: (frame: { type: "replay_gap"; terminalId: string; requestedAfterSeq: number; floorSeq: number }) => void;
      onError?: (event: Event) => void;
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

const encoder = new TextEncoder();

describe("terminal stream registry", () => {
  beforeEach(() => {
    resetTerminalStreamRegistryForTests();
    mockState.connections = [];
    vi.clearAllMocks();
  });

  it("replays buffered entries before live entries and dedupes by seq", () => {
    const identity = streamIdentity();
    ensureConnected({ identity, baseUrl: "http://runtime.test" });
    mockState.connections[0]!.options.onData?.(bytes("one"), dataFrame(1));

    const entries: TerminalReplayEntry[] = [];
    subscribeWithReplay(identity, (entry) => entries.push(entry));
    mockState.connections[0]!.options.onData?.(bytes("one-duplicate"), dataFrame(1));
    mockState.connections[0]!.options.onData?.(bytes("two"), dataFrame(2));

    expect(entries.map((entry) => entry.type)).toEqual(["data", "data"]);
    expect(dataText(entries[0])).toBe("one");
    expect(dataText(entries[1])).toBe("two");
  });

  it("reconnects live terminals with afterSeq", () => {
    const identity = streamIdentity();
    ensureConnected({ identity, baseUrl: "http://runtime.test" });
    mockState.connections[0]!.options.onData?.(bytes("one"), dataFrame(5));
    mockState.connections[0]!.options.onClose?.(new Event("close") as CloseEvent);

    ensureConnected({ identity, baseUrl: "http://runtime.test" });

    expect(connectTerminal).toHaveBeenCalledTimes(2);
    expect(mockState.connections[1]!.options.afterSeq).toBe(5);
  });

  it("keeps runtime identity stable across credential refreshes", () => {
    expect(createTerminalRuntimeIdentity({
      runtimeUrl: "http://runtime.test/",
      anyharnessWorkspaceId: "workspace-1",
      runtimeGeneration: 7,
    })).toBe(createTerminalRuntimeIdentity({
      runtimeUrl: "http://runtime.test",
      anyharnessWorkspaceId: "workspace-1",
      runtimeGeneration: 7,
    }));
    expect(createTerminalRuntimeIdentity({
      runtimeUrl: "http://runtime.test",
      anyharnessWorkspaceId: "workspace-1",
      runtimeGeneration: 8,
    })).not.toBe(createTerminalRuntimeIdentity({
      runtimeUrl: "http://runtime.test",
      anyharnessWorkspaceId: "workspace-1",
      runtimeGeneration: 7,
    }));
  });

  it("removes stale handles on close, error, and exit", () => {
    const closed = streamIdentity("closed");
    const errored = streamIdentity("errored");
    const exited = streamIdentity("exited");

    ensureConnected({ identity: closed, baseUrl: "http://runtime.test" });
    ensureConnected({ identity: errored, baseUrl: "http://runtime.test" });
    ensureConnected({ identity: exited, baseUrl: "http://runtime.test" });

    mockState.connections[0]!.options.onClose?.(new Event("close") as CloseEvent);
    mockState.connections[1]!.options.onError?.(new Event("error"));
    mockState.connections[2]!.options.onExit?.(0);

    expect(hasActiveHandle(closed)).toBe(false);
    expect(hasActiveHandle(errored)).toBe(false);
    expect(hasActiveHandle(exited)).toBe(false);
    expect(mockState.connections[2]!.handle.close).toHaveBeenCalledTimes(1);
  });

  it("does not send input to exited terminals", () => {
    const identity = streamIdentity();
    ensureConnected({ identity, baseUrl: "http://runtime.test" });
    mockState.connections[0]!.options.onExit?.(0);

    sendInput(identity, "ignored");

    expect(mockState.connections[0]!.handle.send).not.toHaveBeenCalled();
  });

  it("does not send input or resize on read-only replay streams", () => {
    const identity = streamIdentity();
    ensureConnected({ identity, baseUrl: "http://runtime.test", readOnly: true });

    sendInput(identity, "ignored");
    sendResize(identity, 80, 24);

    expect(mockState.connections[0]!.handle.send).not.toHaveBeenCalled();
    expect(mockState.connections[0]!.handle.sendResize).not.toHaveBeenCalled();
  });

  it("can mark an existing active stream read-only before exit arrives", () => {
    const identity = streamIdentity();
    ensureConnected({ identity, baseUrl: "http://runtime.test" });

    markReadOnly(identity);
    sendInput(identity, "ignored");
    sendResize(identity, 80, 24);

    expect(mockState.connections[0]!.handle.send).not.toHaveBeenCalled();
    expect(mockState.connections[0]!.handle.sendResize).not.toHaveBeenCalled();
  });

  it("scopes entries by workspace and runtime identity", () => {
    const local = streamIdentity("terminal-1", "runtime-local", "workspace-1");
    const cloud = streamIdentity("terminal-1", "runtime-cloud", "workspace-1");
    const otherWorkspace = streamIdentity("terminal-1", "runtime-local", "workspace-2");

    ensureConnected({ identity: local, baseUrl: "http://local.test" });
    ensureConnected({ identity: cloud, baseUrl: "http://cloud.test" });
    ensureConnected({ identity: otherWorkspace, baseUrl: "http://local.test" });

    clearForRuntime("runtime-local");

    expect(hasActiveHandle(local)).toBe(false);
    expect(hasActiveHandle(otherWorkspace)).toBe(false);
    expect(hasActiveHandle(cloud)).toBe(true);
  });

  it("retires prior runtime identities for the same workspace terminal", () => {
    const oldIdentity = streamIdentity("terminal-1", "runtime-old", "workspace-1");
    const newIdentity = streamIdentity("terminal-1", "runtime-new", "workspace-1");
    const otherTerminal = streamIdentity("terminal-2", "runtime-old", "workspace-1");
    ensureConnected({ identity: oldIdentity, baseUrl: "http://old.test" });
    ensureConnected({ identity: otherTerminal, baseUrl: "http://old.test" });

    adoptTerminalStreamIdentity(newIdentity);
    mockState.connections[0]!.options.onClose?.(new Event("close") as CloseEvent);

    expect(hasActiveHandle(oldIdentity)).toBe(false);
    expect(hasActiveHandle(otherTerminal)).toBe(true);
    expect(mockState.connections[0]!.handle.close).toHaveBeenCalledTimes(1);
  });

  it("clears explicit terminal state across runtime identities", () => {
    const local = streamIdentity("terminal-1", "runtime-local", "workspace-1");
    const cloud = streamIdentity("terminal-1", "runtime-cloud", "workspace-1");
    ensureConnected({ identity: local, baseUrl: "http://local.test" });
    ensureConnected({ identity: cloud, baseUrl: "http://cloud.test" });

    clearTerminal({ workspaceId: "workspace-1", terminalId: "terminal-1" });

    expect(hasActiveHandle(local)).toBe(false);
    expect(hasActiveHandle(cloud)).toBe(false);
  });

  it("records runtime gaps without discarding newer local entries", () => {
    const identity = streamIdentity();
    ensureConnected({ identity, baseUrl: "http://runtime.test" });
    mockState.connections[0]!.options.onData?.(bytes("newer"), dataFrame(100));
    mockState.connections[0]!.options.onReplayGap?.({
      type: "replay_gap",
      terminalId: identity.terminalId,
      requestedAfterSeq: 50,
      floorSeq: 80,
    });

    const entries: TerminalReplayEntry[] = [];
    subscribeWithReplay(identity, (entry) => entries.push(entry));

    expect(entries.map((entry) => entry.type)).toEqual(["runtime-gap", "data"]);
    expect(getLastDataSeq(identity)).toBe(100);
  });

  it("inserts one local overflow marker per lost range", () => {
    const identity = streamIdentity();
    ensureConnected({ identity, baseUrl: "http://runtime.test" });
    for (let seq = 1; seq <= 1010; seq += 1) {
      mockState.connections[0]!.options.onData?.(bytes(String(seq)), dataFrame(seq));
    }

    const entries: TerminalReplayEntry[] = [];
    subscribeWithReplay(identity, (entry) => entries.push(entry));

    expect(entries.filter((entry) => entry.type === "local-overflow")).toHaveLength(1);
    expect(entries[entries.length - 1]?.type).toBe("data");
  });
});

function streamIdentity(
  terminalId = "terminal-1",
  runtimeIdentity = "runtime-1",
  workspaceId = "workspace-1",
): TerminalStreamIdentity {
  return { workspaceId, terminalId, runtimeIdentity };
}

function dataFrame(seq: number) {
  return {
    type: "data" as const,
    seq,
    terminalId: "terminal-1",
    dataBase64: "",
  };
}

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function dataText(entry: TerminalReplayEntry | undefined): string {
  if (entry?.type !== "data") {
    return "";
  }
  return new TextDecoder().decode(entry.data);
}
