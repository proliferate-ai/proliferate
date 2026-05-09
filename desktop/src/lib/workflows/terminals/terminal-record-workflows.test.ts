import {
  AnyHarnessError,
  type CreateTerminalRequest,
  type TerminalRecord,
} from "@anyharness/sdk";
import { describe, expect, it, vi } from "vitest";
import { isMissingTerminalError } from "@/lib/access/anyharness/terminals";
import { RUN_TERMINAL_TITLE } from "@/lib/domain/terminals/run-terminal";
import {
  closeTerminalTabWorkflow,
  createRunTerminalTabWorkflow,
  type CloseTerminalTabDeps,
  type CreateRunTerminalTabDeps,
} from "./terminal-record-workflows";

interface TestConnection {
  id: string;
}

describe("createRunTerminalTabWorkflow", () => {
  it("reuses an active Run terminal from the listed records", async () => {
    const connection = { id: "connection-1" };
    const records = [
      terminalRecord({
        id: "general",
        purpose: "general",
        status: "running",
      }),
      terminalRecord({
        id: "run",
        purpose: "run",
        status: "starting",
      }),
    ];
    const deps = createRunDeps({
      connection,
      records,
    });

    await expect(createRunTerminalTabWorkflow({
      workspaceId: "workspace-1",
      command: "pnpm test",
      cols: 90,
      rows: 30,
    }, deps)).resolves.toBe("run");

    expect(deps.setWorkspaceTerminalRecords).toHaveBeenCalledWith("workspace-1", records);
    expect(deps.createWorkspaceTerminal).not.toHaveBeenCalled();
    expect(deps.invalidateWorkspaceTerminals).not.toHaveBeenCalled();
  });

  it("creates a Run terminal when listing fails", async () => {
    const connection = { id: "connection-1" };
    const deps = createRunDeps({
      connection,
      listError: new Error("list failed"),
      createdRecord: terminalRecord({ id: "created-run", purpose: "run" }),
    });

    await expect(createRunTerminalTabWorkflow({
      workspaceId: "workspace-1",
      command: "cargo test",
    }, deps)).resolves.toBe("created-run");

    expect(deps.setWorkspaceTerminalRecords).not.toHaveBeenCalled();
    expect(deps.createWorkspaceTerminal).toHaveBeenCalledWith(connection, {
      cols: 120,
      rows: 40,
      title: RUN_TERMINAL_TITLE,
      purpose: "run",
      startupCommand: "cargo test",
    });
    expect(deps.invalidateWorkspaceTerminals).toHaveBeenCalledWith("workspace-1");
  });

  it("throws the runtime block reason before resolving a connection", async () => {
    const deps = createRunDeps({
      blockReason: "Runtime is starting",
    });

    await expect(createRunTerminalTabWorkflow({
      workspaceId: "workspace-1",
      command: "pnpm test",
    }, deps)).rejects.toThrow("Runtime is starting");

    expect(deps.resolveWorkspaceConnection).not.toHaveBeenCalled();
    expect(deps.createWorkspaceTerminal).not.toHaveBeenCalled();
  });
});

describe("closeTerminalTabWorkflow", () => {
  it("shows blocked runtime feedback without marking an intentional close", async () => {
    const deps = closeDeps({
      blockReason: "Runtime unavailable",
    });

    await expect(closeTerminalTabWorkflow({
      terminalId: "terminal-1",
      workspaceId: "workspace-1",
    }, deps)).resolves.toBe("blocked");

    expect(deps.showToast).toHaveBeenCalledWith("Runtime unavailable");
    expect(deps.markTerminalIntentionalClose).not.toHaveBeenCalled();
    expect(deps.invalidateWorkspaceTerminals).not.toHaveBeenCalled();
  });

  it("marks intentional close before resolving and clears it before invalidating", async () => {
    const events: string[] = [];
    const connection = { id: "connection-1" };
    const deps = closeDeps({
      connection,
      events,
    });

    await expect(closeTerminalTabWorkflow({
      terminalId: "terminal-1",
      workspaceId: "workspace-1",
    }, deps)).resolves.toBe("closed");

    expect(events).toEqual([
      "mark",
      "resolve",
      "close",
      "clear-state",
      "clear-intentional",
      "invalidate",
    ]);
    expect(deps.closeTerminal).toHaveBeenCalledWith(connection, "terminal-1");
    expect(deps.clearClosedTerminalState).toHaveBeenCalledWith("terminal-1", "workspace-1");
  });

  it("clears local terminal state and returns missing for classified missing errors", async () => {
    const deps = closeDeps({
      closeError: new Error("missing"),
      missingError: true,
    });

    await expect(closeTerminalTabWorkflow({
      terminalId: "terminal-1",
      workspaceId: "workspace-1",
    }, deps)).resolves.toBe("missing");

    expect(deps.clearClosedTerminalState).toHaveBeenCalledWith("terminal-1", "workspace-1");
    expect(deps.clearTerminalIntentionalClose).toHaveBeenCalledWith("terminal-1");
    expect(deps.invalidateWorkspaceTerminals).toHaveBeenCalledWith("workspace-1");
  });

  it("returns failed for non-missing errors and still clears intentional close state", async () => {
    const deps = closeDeps({
      closeError: new Error("network down"),
      missingError: false,
    });

    await expect(closeTerminalTabWorkflow({
      terminalId: "terminal-1",
      workspaceId: "workspace-1",
    }, deps)).resolves.toBe("failed");

    expect(deps.clearClosedTerminalState).not.toHaveBeenCalled();
    expect(deps.clearTerminalIntentionalClose).toHaveBeenCalledWith("terminal-1");
    expect(deps.invalidateWorkspaceTerminals).toHaveBeenCalledWith("workspace-1");
  });
});

describe("isMissingTerminalError", () => {
  it("recognizes terminal 404 and not-found code errors", () => {
    expect(isMissingTerminalError(new AnyHarnessError({
      type: "about:blank",
      title: "Not found",
      status: 404,
      code: "UNKNOWN",
    }))).toBe(true);
    expect(isMissingTerminalError(new AnyHarnessError({
      type: "about:blank",
      title: "Not found",
      status: 500,
      code: "TERMINAL_NOT_FOUND",
    }))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isMissingTerminalError(new AnyHarnessError({
      type: "about:blank",
      title: "Server error",
      status: 500,
      code: "UNKNOWN",
    }))).toBe(false);
    expect(isMissingTerminalError(new Error("plain"))).toBe(false);
  });
});

function createRunDeps(options: {
  connection?: TestConnection;
  records?: TerminalRecord[];
  listError?: unknown;
  createdRecord?: TerminalRecord;
  blockReason?: string | null;
} = {}): CreateRunTerminalTabDeps<TestConnection> {
  const connection = options.connection ?? { id: "connection-1" };
  return {
    getWorkspaceRuntimeBlockReason: vi.fn(() => options.blockReason ?? null),
    resolveWorkspaceConnection: vi.fn(async () => connection),
    listWorkspaceTerminals: vi.fn(async () => {
      if (options.listError) {
        throw options.listError;
      }
      return options.records ?? [];
    }),
    setWorkspaceTerminalRecords: vi.fn(),
    createWorkspaceTerminal: vi.fn(async (
      _connection: TestConnection,
      _request: CreateTerminalRequest,
    ) => options.createdRecord ?? terminalRecord({ id: "created" })),
    invalidateWorkspaceTerminals: vi.fn(async () => undefined),
  };
}

function closeDeps(options: {
  connection?: TestConnection;
  closeError?: unknown;
  missingError?: boolean;
  blockReason?: string | null;
  events?: string[];
} = {}): CloseTerminalTabDeps<TestConnection> {
  const events = options.events;
  const connection = options.connection ?? { id: "connection-1" };
  return {
    getWorkspaceRuntimeBlockReason: vi.fn(() => options.blockReason ?? null),
    showToast: vi.fn(),
    markTerminalIntentionalClose: vi.fn((terminalId: string) => {
      expect(terminalId).toBe("terminal-1");
      events?.push("mark");
    }),
    clearTerminalIntentionalClose: vi.fn((terminalId: string) => {
      expect(terminalId).toBe("terminal-1");
      events?.push("clear-intentional");
    }),
    resolveWorkspaceConnection: vi.fn(async () => {
      events?.push("resolve");
      return connection;
    }),
    closeTerminal: vi.fn(async () => {
      events?.push("close");
      if (options.closeError) {
        throw options.closeError;
      }
    }),
    clearClosedTerminalState: vi.fn(() => {
      events?.push("clear-state");
    }),
    isMissingTerminalError: vi.fn(() => options.missingError ?? false),
    invalidateWorkspaceTerminals: vi.fn(async () => {
      events?.push("invalidate");
    }),
  };
}

function terminalRecord(overrides: Partial<TerminalRecord> = {}): TerminalRecord {
  return {
    commandRun: null,
    createdAt: "2026-01-01T00:00:00Z",
    cwd: "/Users/pablo/proliferate",
    id: "terminal-1",
    purpose: "general",
    status: "running",
    title: "Terminal",
    updatedAt: "2026-01-01T00:00:00Z",
    workspaceId: "workspace-1",
    ...overrides,
  };
}
