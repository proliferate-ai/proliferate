// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import {
  WORKSPACE_UI_DEFAULTS,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";

const hookMocks = vi.hoisted(() => ({
  selectSession: vi.fn(),
  scheduledCallbacks: [] as Array<() => void>,
}));

const measurementMocks = vi.hoisted(() => {
  const state = {
    nextOperation: 0,
    finishOrCancelMeasurementOperation: vi.fn(),
    markOperationForNextCommit: vi.fn(),
    recordMeasurementDiagnostic: vi.fn(),
    recordMeasurementWorkflowStep: vi.fn(),
    startMeasurementOperation: vi.fn(() => ""),
  };
  state.startMeasurementOperation.mockImplementation(() => `mop_${++state.nextOperation}`);
  return state;
});

vi.mock("@/hooks/sessions/use-session-actions", () => ({
  useSessionActions: () => ({
    selectSession: hookMocks.selectSession,
  }),
}));

vi.mock("@/lib/infra/schedule-after-next-paint", () => ({
  scheduleAfterNextPaint: vi.fn((callback: () => void) => {
    hookMocks.scheduledCallbacks.push(callback);
    return () => {
      hookMocks.scheduledCallbacks = hookMocks.scheduledCallbacks
        .filter((candidate) => candidate !== callback);
    };
  }),
}));

vi.mock("@/lib/infra/debug-measurement", () => ({
  finishOrCancelMeasurementOperation:
    measurementMocks.finishOrCancelMeasurementOperation,
  isDebugMeasurementEnabled: () => false,
  markOperationForNextCommit: measurementMocks.markOperationForNextCommit,
  recordMeasurementDiagnostic: measurementMocks.recordMeasurementDiagnostic,
  recordMeasurementWorkflowStep: measurementMocks.recordMeasurementWorkflowStep,
  startMeasurementOperation: measurementMocks.startMeasurementOperation,
}));

beforeEach(() => {
  vi.clearAllMocks();
  measurementMocks.nextOperation = 0;
  hookMocks.scheduledCallbacks = [];
  useSessionSelectionStore.getState().clearSelection();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
  useSessionSelectionStore.setState({
    hydrated: true,
    selectedLogicalWorkspaceId: null,
  });
  useWorkspaceUiStore.setState({
    ...WORKSPACE_UI_DEFAULTS,
    _hydrated: true,
    shellActivationEpochByWorkspace: {},
    pendingChatActivationByWorkspace: {},
  });
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: null,
    workspaceId: "workspace-1",
  });
  putSessionRecord(
    createEmptySessionRecord("session-1", "codex", {
      workspaceId: "workspace-1",
    }),
  );
  putSessionRecord(
    createEmptySessionRecord("session-2", "codex", {
      workspaceId: "workspace-1",
    }),
  );
  hookMocks.selectSession.mockImplementation(async (sessionId: string, options: any) => ({
    result: "completed",
    sessionId,
    guard: options.guard,
    activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
  }));
});

describe("useWorkspaceShellActivation", () => {
  it("sets pending chat activation before durable shell intent or real selection", async () => {
    const { result } = renderHook(() => useWorkspaceShellActivation());

    let activationPromise!: Promise<unknown>;
    act(() => {
      activationPromise = result.current.activateChatTab({
        workspaceId: "workspace-1",
        sessionId: "session-1",
      });
    });

    const pending =
      useWorkspaceUiStore.getState().pendingChatActivationByWorkspace["workspace-1"];
    expect(pending).toMatchObject({
      sessionId: "session-1",
      intent: "chat:session-1",
      shellEpochAtWrite: 0,
    });
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["workspace-1"])
      .toBeUndefined();
    expect(hookMocks.selectSession).not.toHaveBeenCalled();
    expect(hookMocks.scheduledCallbacks).toHaveLength(1);
    expect(measurementMocks.recordMeasurementWorkflowStep).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "mop_1",
        step: "workspace.shell.pending_activation",
      }),
    );

    await act(async () => {
      hookMocks.scheduledCallbacks.shift()?.();
      await activationPromise;
    });

    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["workspace-1"])
      .toBe("chat:session-1");
    expect(hookMocks.selectSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        measurementOperationId: "mop_1",
        reuseMeasurementOperation: true,
      }),
    );
  });

  it("resolves stale without real selection when superseded before phase two", async () => {
    const { result } = renderHook(() => useWorkspaceShellActivation());

    let activationPromise!: Promise<any>;
    act(() => {
      activationPromise = result.current.activateChatTab({
        workspaceId: "workspace-1",
        sessionId: "session-1",
      });
    });
    useSessionSelectionStore.getState()
      .bumpSessionActivationIntentEpoch("workspace-1");

    let outcome: any;
    await act(async () => {
      hookMocks.scheduledCallbacks.shift()?.();
      outcome = await activationPromise;
    });

    expect(outcome).toMatchObject({
      result: "stale",
      sessionId: "session-1",
      reason: "intent-replaced",
    });
    expect(hookMocks.selectSession).not.toHaveBeenCalled();
    expect(measurementMocks.finishOrCancelMeasurementOperation)
      .toHaveBeenCalledWith("mop_1", "aborted");
  });

  it("aborts the previous pending hot-switch measurement when superseded", async () => {
    const { result } = renderHook(() => useWorkspaceShellActivation());

    let firstPromise!: Promise<unknown>;
    let secondPromise!: Promise<unknown>;
    act(() => {
      firstPromise = result.current.activateChatTab({
        workspaceId: "workspace-1",
        sessionId: "session-1",
      });
      secondPromise = result.current.activateChatTab({
        workspaceId: "workspace-1",
        sessionId: "session-2",
      });
    });

    expect(measurementMocks.finishOrCancelMeasurementOperation)
      .toHaveBeenCalledWith("mop_1", "aborted");
    expect(
      useWorkspaceUiStore.getState().pendingChatActivationByWorkspace["workspace-1"],
    ).toMatchObject({
      sessionId: "session-2",
      intent: "chat:session-2",
    });

    await act(async () => {
      hookMocks.scheduledCallbacks.shift()?.();
      hookMocks.scheduledCallbacks.shift()?.();
      await Promise.all([firstPromise, secondPromise]);
    });
  });

  it("rolls back durable shell intent only after phase two wrote it", async () => {
    const { result } = renderHook(() => useWorkspaceShellActivation());
    useWorkspaceUiStore.getState().writeShellIntent({
      workspaceId: "workspace-1",
      intent: "chat:session-2",
    });
    hookMocks.selectSession.mockImplementationOnce(async (_sessionId: string, options: any) => ({
      result: "stale",
      sessionId: "session-1",
      guard: options.guard,
      reason: "intent-replaced",
    }));

    let activationPromise!: Promise<unknown>;
    act(() => {
      activationPromise = result.current.activateChatTab({
        workspaceId: "workspace-1",
        sessionId: "session-1",
      });
    });

    await act(async () => {
      hookMocks.scheduledCallbacks.shift()?.();
      await activationPromise;
    });

    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["workspace-1"])
      .toBe("chat:session-2");
    expect(measurementMocks.recordMeasurementWorkflowStep).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "mop_1",
        step: "workspace.shell.pending_rollback",
      }),
    );
  });
});
