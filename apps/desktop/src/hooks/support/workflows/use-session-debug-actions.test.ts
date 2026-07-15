/* @vitest-environment jsdom */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthResponse } from "@anyharness/sdk";
import { useSessionDebugActions } from "@/hooks/support/workflows/use-session-debug-actions";
import type { SessionDebugActionState } from "@/lib/domain/support/session-debug/action-state";

const runtimeUrl = "http://127.0.0.1:7007";
const replayHealth = {
  agentReconcile: {
    status: "idle",
    installed: 0,
    alreadyInstalled: 0,
    skipped: 0,
    failed: 0,
  },
  agentSeed: {
    lastAction: "none",
    ownership: "not_configured",
    repairedArtifactCount: 0,
    seedOwnedArtifactCount: 0,
    seedVersion: null,
    seededAgents: [],
    skippedExistingArtifactCount: 0,
    source: "none",
    status: "not_configured_dev",
    target: null,
  },
  capabilities: { replay: true },
  runtimeHome: "/Users/pablo/.proliferate/anyharness",
  status: "ok",
  version: "0.1.17",
} satisfies HealthResponse;

const mockState = vi.hoisted(() => ({
  runtime: {
    runtimeUrl: "http://127.0.0.1:7007",
  },
  selection: {
    selectedWorkspaceId: "workspace-ui",
    selectedLogicalWorkspaceId: "logical-workspace",
    activeSessionId: "session-123",
  } as Pick<
    SessionDebugActionState,
    "activeSessionId" | "selectedLogicalWorkspaceId" | "selectedWorkspaceId"
  >,
  directory: {
    entriesById: {
      "session-123": {
        sessionId: "session-123",
        materializedSessionId: "session-123",
        workspaceId: "workspace-ui",
        agentKind: "codex",
        modelId: "gpt-5.4",
        modeId: "default",
        title: "Debug session",
        status: "idle",
        actionCapabilities: { fork: false, targetedFork: false },
      },
    } as SessionDebugActionState["sessionRecords"],
  },
}));
const resolveConnection = vi.hoisted(() => vi.fn(async () => ({
  runtimeUrl: "http://127.0.0.1:7007",
  anyharnessWorkspaceId: "workspace-ah",
})));
const resolveWorkspaceConnectionFromContext = vi.hoisted(() => vi.fn(async (
  _context: unknown,
  workspaceId: string,
) => ({
  workspaceId,
  connection: {
    runtimeUrl: "http://127.0.0.1:7007",
    anyharnessWorkspaceId: "workspace-ah",
  },
})));
const runtimeGetHealth = vi.hoisted(() => vi.fn());
const createSessionDebugClient = vi.hoisted(() => vi.fn(() => ({
  runtime: {
    getHealth: runtimeGetHealth,
  },
  sessions: {
    get: vi.fn(),
    list: vi.fn(),
    listEvents: vi.fn(),
    listRawNotifications: vi.fn(),
    getLiveConfig: vi.fn(),
  },
})));
const saveDiagnosticJson = vi.hoisted(() => vi.fn(async () => "/tmp/debug.json"));
const copyText = vi.hoisted(() => vi.fn(async () => {}));
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessWorkspaceContext: () => ({
    workspaceId: "context-workspace",
    resolveConnection,
  }),
  resolveWorkspaceConnectionFromContext,
}));

vi.mock("@/lib/access/anyharness/debug-client", () => ({
  createSessionDebugClient,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: copyText },
    desktop: { diagnostics: { saveJson: saveDiagnosticJson } },
  }),
}));

vi.mock("@/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (selector: (state: typeof mockState.runtime) => unknown) =>
    selector(mockState.runtime),
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: typeof mockState.selection) => unknown) =>
    selector(mockState.selection),
}));

vi.mock("@/stores/sessions/session-directory-store", () => ({
  useSessionDirectoryStore: (selector: (state: typeof mockState.directory) => unknown) =>
    selector(mockState.directory),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

beforeEach(() => {
  vi.stubEnv("DEV", true);
  runtimeGetHealth.mockResolvedValue(replayHealth);
  mockState.runtime.runtimeUrl = runtimeUrl;
  mockState.selection.selectedWorkspaceId = "workspace-ui";
  mockState.selection.selectedLogicalWorkspaceId = "logical-workspace";
  mockState.selection.activeSessionId = "session-123";
  mockState.directory.entriesById = {
    "session-123": {
      sessionId: "session-123",
      materializedSessionId: "session-123",
      workspaceId: "workspace-ui",
      agentKind: "codex",
      modelId: "gpt-5.4",
      modeId: "default",
      title: "Debug session",
      status: "idle",
      actionCapabilities: { fork: false, targetedFork: false },
    },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("useSessionDebugActions", () => {
  it("returns the flat support debug action model and probes replay capability", async () => {
    const { result } = renderHook(() => useSessionDebugActions());

    expect(result.current.canCopyInvestigationJson).toBe(true);
    expect(result.current.canExportActiveSessionJson).toBe(true);
    expect(result.current.canExportWorkspaceJson).toBe(true);
    expect(result.current.canExportReplayRecording).toBe(false);
    expect(result.current.isCopyingInvestigationJson).toBe(false);
    expect(result.current.isExportingSessionDebugJson).toBe(false);
    expect(result.current.isExportingReplayRecording).toBe(false);
    expect(result.current.isExportingWorkspaceDebugJson).toBe(false);

    await waitFor(() => {
      expect(result.current.canExportReplayRecording).toBe(true);
    });
    expect(resolveWorkspaceConnectionFromContext).toHaveBeenCalledWith(
      {
        workspaceId: "context-workspace",
        resolveConnection,
      },
      "workspace-ui",
    );
    expect(createSessionDebugClient).toHaveBeenCalledWith({
      runtimeUrl: "http://127.0.0.1:7007",
      anyharnessWorkspaceId: "workspace-ah",
    });
  });

  it("keeps replay export unavailable when the probe cannot run", () => {
    mockState.selection.activeSessionId = null;
    mockState.directory.entriesById = {};

    const { result } = renderHook(() => useSessionDebugActions());

    expect(result.current.canCopyInvestigationJson).toBe(true);
    expect(result.current.canExportActiveSessionJson).toBe(false);
    expect(result.current.canExportReplayRecording).toBe(false);
    expect(resolveWorkspaceConnectionFromContext).not.toHaveBeenCalled();
  });
});
