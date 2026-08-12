// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import {
  WORKSPACE_UI_DEFAULTS,
} from "#product/lib/domain/preferences/workspace-ui/model";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";

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

vi.mock("#product/hooks/sessions/facade/use-session-selection-actions", () => ({
  useSessionSelectionActions: () => ({
    selectSession: hookMocks.selectSession,
  }),
}));

vi.mock("#product/lib/infra/scheduling/schedule-after-next-paint", () => ({
  scheduleAfterNextPaint: vi.fn((callback: () => void) => {
    hookMocks.scheduledCallbacks.push(callback);
    return () => {
      hookMocks.scheduledCallbacks = hookMocks.scheduledCallbacks
        .filter((candidate) => candidate !== callback);
    };
  }),
}));

vi.mock("#product/lib/infra/measurement/measurement-port", () => ({
  finishOrCancelMeasurementOperation:
    measurementMocks.finishOrCancelMeasurementOperation,
  isDebugMeasurementEnabled: () => false,
  markOperationForNextCommit: measurementMocks.markOperationForNextCommit,
  recordMeasurementDiagnostic: measurementMocks.recordMeasurementDiagnostic,
  recordMeasurementWorkflowStep: measurementMocks.recordMeasurementWorkflowStep,
  startMeasurementOperation: measurementMocks.startMeasurementOperation,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  measurementMocks.nextOperation = 0;
  hookMocks.scheduledCallbacks = [];
  useSessionSelectionStore.getState().clearSelection();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
  useSessionSelectionStore.setState({
    _hydrated: true,
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

afterEach(() => {
  vi.useRealTimers();
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

    await act(async () => {
      vi.advanceTimersByTime(180);
    });

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

  it("opens a materialized session by focusing its existing client tab", async () => {
    putSessionRecord(createEmptySessionRecord("client-session:codex:existing", "codex", {
      materializedSessionId: "runtime-session-existing",
      workspaceId: "workspace-1",
    }));
    const { result } = renderHook(() => useWorkspaceShellActivation());

    let activationPromise!: Promise<unknown>;
    act(() => {
      activationPromise = result.current.activateChatTab({
        workspaceId: "workspace-1",
        sessionId: "runtime-session-existing",
      });
    });

    expect(
      useWorkspaceUiStore.getState().pendingChatActivationByWorkspace["workspace-1"],
    ).toMatchObject({
      sessionId: "client-session:codex:existing",
      intent: "chat:client-session:codex:existing",
    });

    await act(async () => {
      vi.advanceTimersByTime(180);
      hookMocks.scheduledCallbacks.shift()?.();
      await activationPromise;
    });

    expect(hookMocks.selectSession).toHaveBeenCalledWith(
      "client-session:codex:existing",
      expect.any(Object),
    );
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["workspace-1"])
      .toBe("chat:client-session:codex:existing");
    expect(useSessionDirectoryStore.getState().entriesById["runtime-session-existing"])
      .toBeUndefined();
  });

  it("uses a client identity that materializes during deferred activation", async () => {
    const clientSessionId = "client-session:codex:materializing";
    const materializedSessionId = "runtime-session-materializing";
    putSessionRecord(createEmptySessionRecord(clientSessionId, "codex", {
      materializedSessionId: null,
      workspaceId: "workspace-1",
    }));
    hookMocks.selectSession.mockImplementationOnce(async (sessionId: string, options: any) => {
      if (!getSessionRecord(sessionId)) {
        putSessionRecord(createEmptySessionRecord(sessionId, "codex", {
          workspaceId: "workspace-1",
        }));
      }
      return {
        result: "completed",
        sessionId,
        guard: options.guard,
        activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
      };
    });
    const { result } = renderHook(() => useWorkspaceShellActivation());

    let activationPromise!: Promise<unknown>;
    act(() => {
      activationPromise = result.current.activateChatTab({
        workspaceId: "workspace-1",
        sessionId: materializedSessionId,
      });
    });

    expect(
      useWorkspaceUiStore.getState().pendingChatActivationByWorkspace["workspace-1"],
    ).toMatchObject({
      sessionId: materializedSessionId,
      intent: `chat:${materializedSessionId}`,
    });

    patchSessionRecord(clientSessionId, { materializedSessionId });

    await act(async () => {
      vi.advanceTimersByTime(180);
      hookMocks.scheduledCallbacks.shift()?.();
      await activationPromise;
    });

    expect(hookMocks.selectSession).toHaveBeenCalledWith(
      clientSessionId,
      expect.any(Object),
    );
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["workspace-1"])
      .toBe(`chat:${clientSessionId}`);
    expect(useSessionDirectoryStore.getState().entriesById[materializedSessionId])
      .toBeUndefined();
  });

  it("updates the durable tab intent when selection discovers a client identity", async () => {
    const clientSessionId = "client-session:codex:selecting";
    const materializedSessionId = "runtime-session-selecting";
    putSessionRecord(createEmptySessionRecord(clientSessionId, "codex", {
      materializedSessionId: null,
      workspaceId: "workspace-1",
    }));
    const selectionGate = deferred<any>();
    hookMocks.selectSession.mockImplementationOnce(() => selectionGate.promise);
    const { result } = renderHook(() => useWorkspaceShellActivation());

    let activationPromise!: Promise<unknown>;
    act(() => {
      activationPromise = result.current.activateChatTab({
        workspaceId: "workspace-1",
        sessionId: materializedSessionId,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(180);
      hookMocks.scheduledCallbacks.shift()?.();
      await Promise.resolve();
    });

    expect(hookMocks.selectSession).toHaveBeenCalledWith(
      materializedSessionId,
      expect.any(Object),
    );
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["workspace-1"])
      .toBe(`chat:${materializedSessionId}`);

    patchSessionRecord(clientSessionId, { materializedSessionId });
    const guard = hookMocks.selectSession.mock.calls[0]?.[1].guard;
    await act(async () => {
      selectionGate.resolve({
        result: "completed",
        sessionId: clientSessionId,
        guard,
        activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
      });
      await activationPromise;
    });

    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["workspace-1"])
      .toBe(`chat:${clientSessionId}`);
    expect(useWorkspaceUiStore.getState().pendingChatActivationByWorkspace["workspace-1"])
      .toBeNull();
    expect(useSessionDirectoryStore.getState().entriesById[materializedSessionId])
      .toBeUndefined();
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
      vi.advanceTimersByTime(180);
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

    expect(hookMocks.scheduledCallbacks).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(180);
      expect(hookMocks.scheduledCallbacks).toHaveLength(1);
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
      vi.advanceTimersByTime(180);
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
