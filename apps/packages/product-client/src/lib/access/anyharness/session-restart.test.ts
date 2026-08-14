import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restartSessionsOnNewAuth } from "#product/lib/access/anyharness/session-restart";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

const mocks = vi.hoisted(() => ({
  getSessionClientAndWorkspace: vi.fn(),
  dismissSession: vi.fn(),
  restoreDismissedSession: vi.fn(),
  resumeSession: vi.fn(),
}));
let diagnostics: RendererDiagnosticInput[] = [];

vi.mock("#product/lib/access/anyharness/session-runtime", () => ({
  getSessionClientAndWorkspace: mocks.getSessionClientAndWorkspace,
}));

vi.mock("#product/lib/access/anyharness/sessions", () => ({
  dismissSession: mocks.dismissSession,
  restoreDismissedSession: mocks.restoreDismissedSession,
  resumeSession: mocks.resumeSession,
}));

function connectionFor(sessionId: string) {
  return {
    runtimeUrl: "http://runtime.test",
    anyharnessWorkspaceId: `ah-${sessionId}`,
  };
}

function stubResolution() {
  mocks.getSessionClientAndWorkspace.mockImplementation((sessionId: string) =>
    Promise.resolve({
      connection: connectionFor(sessionId),
      materializedSessionId: `mat-${sessionId}`,
      workspaceId: "ws-1",
      target: null,
    }),
  );
}

describe("restartSessionsOnNewAuth", () => {
  beforeEach(() => {
    diagnostics = [];
    setRendererDiagnosticsSink({ emit: (input) => diagnostics.push(input) });
  });

  afterEach(() => {
    resetRendererDiagnosticsSinkForTest();
    vi.clearAllMocks();
  });

  it("relaunches each session as dismiss then restore then resume on the SAME id (Proof C6: transcript kept)", async () => {
    stubResolution();
    const calls: string[] = [];
    mocks.dismissSession.mockImplementation((_c, id: string) => {
      calls.push(`dismiss:${id}`);
      return Promise.resolve({});
    });
    mocks.restoreDismissedSession.mockImplementation((connection: { anyharnessWorkspaceId: string }) => {
      calls.push(`restore:${connection.anyharnessWorkspaceId}`);
      return Promise.resolve({});
    });
    mocks.resumeSession.mockImplementation((_c, id: string) => {
      calls.push(`resume:${id}`);
      return Promise.resolve({});
    });

    const outcome = await restartSessionsOnNewAuth(
      [{ sessionId: "s1", workspaceId: "ws-1" }],
      null,
      null,
    );

    // Kill-and-relaunch composed from existing session APIs: retire the live
    // agent process, clear the dismissal, and resume — the resume relaunch
    // re-runs route_auth on the new auth; the session id (and transcript)
    // never changes.
    expect(calls).toEqual(["dismiss:mat-s1", "restore:ah-s1", "resume:mat-s1"]);
    expect(outcome).toEqual({ restartedSessionIds: ["s1"], failedSessionIds: [] });
  });

  it("serializes restarts within one workspace and runs workspaces concurrently", async () => {
    stubResolution();
    const events: string[] = [];
    const gates = new Map<string, () => void>();
    mocks.dismissSession.mockImplementation((_c, id: string) => {
      events.push(`dismiss:${id}`);
      return new Promise<void>((resolve) => {
        gates.set(id, resolve);
      });
    });
    mocks.restoreDismissedSession.mockResolvedValue({});
    mocks.resumeSession.mockImplementation((_c, id: string) => {
      events.push(`resume:${id}`);
      return Promise.resolve({});
    });

    const pending = restartSessionsOnNewAuth(
      [
        { sessionId: "a1", workspaceId: "ws-a" },
        { sessionId: "a2", workspaceId: "ws-a" },
        { sessionId: "b1", workspaceId: "ws-b" },
      ],
      null,
      null,
    );

    // Both workspace lanes start concurrently, but ws-a's second session must
    // wait for its first to finish (the restore pop pairs with OUR dismiss
    // only while the lane is serialized).
    await vi.waitFor(() => {
      expect(events).toContain("dismiss:mat-a1");
      expect(events).toContain("dismiss:mat-b1");
    });
    expect(events).not.toContain("dismiss:mat-a2");

    gates.get("mat-b1")?.();
    gates.get("mat-a1")?.();
    await vi.waitFor(() => expect(events).toContain("dismiss:mat-a2"));
    gates.get("mat-a2")?.();

    const outcome = await pending;
    expect(outcome.restartedSessionIds.sort()).toEqual(["a1", "a2", "b1"]);
    expect(outcome.failedSessionIds).toEqual([]);
  });

  it("tolerates a per-session failure and keeps restarting the rest", async () => {
    stubResolution();
    mocks.dismissSession.mockImplementation((_c, id: string) =>
      id === "mat-bad"
        ? Promise.reject(new Error("runtime down"))
        : Promise.resolve({}),
    );
    mocks.restoreDismissedSession.mockResolvedValue({});
    mocks.resumeSession.mockResolvedValue({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const outcome = await restartSessionsOnNewAuth(
      [
        { sessionId: "bad", workspaceId: "ws-1" },
        { sessionId: "good", workspaceId: "ws-1" },
      ],
      null,
      null,
    );

    // The failed session surfaces its normal error state through the session
    // machinery — the restart flow records it and moves on, never throwing.
    expect(outcome).toEqual({
      restartedSessionIds: ["good"],
      failedSessionIds: ["bad"],
    });
    expect(mocks.resumeSession).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    expect(diagnostics).toContainEqual(expect.objectContaining({
      name: "renderer.agent_auth.session_restart_failed",
      errorClassification: "session_restart_failed",
      correlation: { sessionId: "bad" },
    }));
    warn.mockRestore();
  });
});
