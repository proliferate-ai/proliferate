import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  committedReplacedSessionTombstonesForWorkspace,
  filterReplacedSessionTombstones,
  hydrateCommittedReplacedSessionTombstones,
  isReplacedSessionTombstoned,
  resetReplacedSessionTombstonesForTests,
} from "#product/hooks/sessions/workflows/session-replacement-tombstones";
import {
  resetSessionReplacementDismissalsForTests,
} from "#product/hooks/sessions/workflows/session-replacement-dismissals";
import { scheduleCreatedRuntimeSessionCleanup } from "#product/hooks/sessions/workflows/session-created-runtime-cleanup";
import { materializeSessionCreation } from "#product/hooks/sessions/workflows/session-creation-materialization";
import {
  beginEmptySessionReplacement,
  type EmptySessionReplacementTransaction,
} from "#product/hooks/sessions/workflows/use-empty-session-replacement-cleanup";
import { reconcileReplacedSessionTombstones } from "#product/hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
  removeSessionRecord,
} from "#product/stores/sessions/session-records";
import {
  commitSupersededSessionCreation,
  registerSessionCreation,
  resetSessionCreationSupersessionForTests,
  supersedeInFlightSessionCreation,
} from "#product/hooks/sessions/workflows/session-creation-supersession";

const mocks = vi.hoisted(() => ({
  applySessionLaunchDefaults: vi.fn(),
  createSession: vi.fn(),
  dismissSession: vi.fn(() => new Promise<void>(() => undefined)),
  resolveDesktopRuntimeUrlForWorkspace: vi.fn(async () => "http://runtime.test"),
  writeTombstones: vi.fn(() => true),
  actualShouldDiscardSupersededSessionCreation: null as null | ((
    sessionId: string,
  ) => Promise<boolean>),
  shouldDiscardSupersededSessionCreationOverride: null as null | ((
    sessionId: string,
  ) => Promise<boolean>),
}));

vi.mock("#product/hooks/sessions/workflows/session-creation-supersession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#product/hooks/sessions/workflows/session-creation-supersession")>();
  mocks.actualShouldDiscardSupersededSessionCreation =
    actual.shouldDiscardSupersededSessionCreation;
  return {
    ...actual,
    shouldDiscardSupersededSessionCreation: (sessionId: string) => (
      mocks.shouldDiscardSupersededSessionCreationOverride?.(sessionId)
      ?? actual.shouldDiscardSupersededSessionCreation(sessionId)
    ),
  };
});

vi.mock("#product/lib/access/anyharness/sessions", async (importOriginal) => ({
  ...await importOriginal<typeof import("#product/lib/access/anyharness/sessions")>(),
  createSession: mocks.createSession,
  dismissSession: mocks.dismissSession,
}));

vi.mock("#product/lib/workflows/sessions/session-launch-defaults", () => ({
  applySessionLaunchDefaults: mocks.applySessionLaunchDefaults,
}));

vi.mock("#product/lib/access/anyharness/runtime-target", () => ({
  resolveRuntimeTargetForWorkspace: vi.fn(async () => ({
    baseUrl: "http://runtime.test",
    authToken: null,
    anyharnessWorkspaceId: "workspace-1",
    location: "local",
    runtimeGeneration: 1,
    cloudWorkspaceId: null,
    targetId: null,
  })),
}));

vi.mock("#product/hooks/sessions/workflows/session-creation-runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("#product/hooks/sessions/workflows/session-creation-runtime")>(),
  resolveDesktopRuntimeUrlForWorkspace: mocks.resolveDesktopRuntimeUrlForWorkspace,
}));

vi.mock("#product/lib/access/anyharness/direct-session-create-guard", () => ({
  assertDirectSessionCreateSupported: vi.fn(),
}));

vi.mock("#product/lib/access/persistence/session-replacement-tombstones-storage", () => ({
  readSessionReplacementTombstones: () => ({}),
  writeSessionReplacementTombstones: mocks.writeTombstones,
}));

beforeEach(() => {
  mocks.dismissSession.mockClear();
  mocks.dismissSession.mockImplementation(() => new Promise<void>(() => undefined));
  mocks.writeTombstones.mockReset();
  mocks.writeTombstones.mockReturnValue(true);
  mocks.applySessionLaunchDefaults.mockReset();
  mocks.createSession.mockReset();
  mocks.resolveDesktopRuntimeUrlForWorkspace.mockClear();
  mocks.shouldDiscardSupersededSessionCreationOverride = null;
  resetReplacedSessionTombstonesForTests();
  resetSessionReplacementDismissalsForTests();
  resetSessionCreationSupersessionForTests();
});

describe("created runtime cleanup", () => {
  it("commits runtime and client suppression without awaiting dismissal", async () => {
    const result = scheduleCreatedRuntimeSessionCleanup({
      connection: {} as never,
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-created",
      clientSessionId: "client-created",
      captureException: vi.fn(),
    });

    await expect(result).resolves.toBe(true);
    await vi.waitFor(() => {
      expect(mocks.dismissSession).toHaveBeenCalledWith({}, "runtime-created");
    });
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual(["runtime-created"]);
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-created")).toBe(true);
    expect(isReplacedSessionTombstoned("workspace-1", "client-created")).toBe(true);
  });

  it("retires the runtime when persistence fails but dismissal confirms absence", async () => {
    mocks.writeTombstones.mockReturnValue(false);
    mocks.dismissSession.mockResolvedValue();

    await expect(scheduleCreatedRuntimeSessionCleanup({
      connection: {} as never,
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-created",
      clientSessionId: "client-created",
      captureException: vi.fn(),
    })).resolves.toBe(true);

    expect(mocks.dismissSession).toHaveBeenCalledOnce();
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual([]);
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-created"))
      .toBe(true);
    expect(isReplacedSessionTombstoned("workspace-1", "client-created"))
      .toBe(true);
  });

  it("releases suppression when neither persistence nor dismissal can retire the runtime", async () => {
    mocks.writeTombstones.mockReturnValue(false);
    mocks.dismissSession.mockRejectedValue(new Error("runtime unavailable"));

    await expect(scheduleCreatedRuntimeSessionCleanup({
      connection: {} as never,
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-created",
      clientSessionId: "client-created",
      captureException: vi.fn(),
    })).resolves.toBe(false);

    expect(mocks.dismissSession).toHaveBeenCalledTimes(3);
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-created")).toBe(false);
    expect(isReplacedSessionTombstoned("workspace-1", "client-created")).toBe(false);
  });

  it("publishes a created runtime when launch failure cleanup cannot retire it", async () => {
    const pendingSessionId = "pending-retained-runtime";
    const projectedRecord = createEmptySessionRecord(pendingSessionId, "claude", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "sonnet",
    });
    putSessionRecord(projectedRecord);
    mocks.createSession.mockResolvedValue({
      id: "runtime-retained",
      workspaceId: "workspace-1",
      agentKind: "claude",
      modelId: "sonnet",
      status: "idle",
    });
    mocks.applySessionLaunchDefaults.mockRejectedValue(new Error("defaults failed"));
    mocks.writeTombstones.mockReturnValue(false);
    mocks.dismissSession.mockRejectedValue(new Error("runtime unavailable"));
    const upsertWorkspaceSessionRecord = vi.fn();
    const localRuntime = { getConnection: vi.fn(), restart: vi.fn() };

    await expect(materializeSessionCreation({
      trackProductEvent: vi.fn(),
      captureException: vi.fn(),
      ensureCloudAgentCatalog: vi.fn(async () => ({ agents: [] })),
      existingProjectedRecord: projectedRecord,
      frozenDefaultLiveSessionControlValuesByAgentKind: {},
      localRuntime,
      cloudClient: null,
      options: {
        text: "",
        agentKind: "claude",
        modelId: "sonnet",
        workspaceId: "workspace-1",
      },
      pendingSessionId,
      resolvedModeId: null,
      upsertWorkspaceSessionRecord,
      workspaceId: "workspace-1",
    })).resolves.toBe(pendingSessionId);

    expect(mocks.resolveDesktopRuntimeUrlForWorkspace).toHaveBeenCalledWith(
      "workspace-1",
      localRuntime,
    );
    expect(getSessionRecord(pendingSessionId)?.materializedSessionId)
      .toBe("runtime-retained");
    expect(upsertWorkspaceSessionRecord).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({ id: "runtime-retained" }),
    );
    removeSessionRecord(pendingSessionId);
  });

  it("recreates a removed superseded shell when its runtime cannot be retired", async () => {
    const pendingSessionId = "pending-superseded-runtime";
    const projectedRecord = createEmptySessionRecord(pendingSessionId, "claude", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "sonnet",
    });
    putSessionRecord(projectedRecord);
    const createGate = deferred<{
      id: string;
      workspaceId: string;
      agentKind: string;
      modelId: string;
      status: string;
    }>();
    mocks.createSession.mockReturnValueOnce(createGate.promise);
    mocks.writeTombstones.mockReturnValue(false);
    mocks.dismissSession.mockRejectedValue(new Error("runtime unavailable"));
    const upsertWorkspaceSessionRecord = vi.fn();
    const unregister = registerSessionCreation(pendingSessionId);
    const materialization = materializeSessionCreation({
      trackProductEvent: vi.fn(),
      captureException: vi.fn(),
      ensureCloudAgentCatalog: vi.fn(async () => ({ agents: [] })),
      existingProjectedRecord: projectedRecord,
      frozenDefaultLiveSessionControlValuesByAgentKind: {},
      localRuntime: null,
      cloudClient: null,
      options: {
        text: "",
        agentKind: "claude",
        modelId: "sonnet",
        workspaceId: "workspace-1",
      },
      pendingSessionId,
      resolvedModeId: null,
      upsertWorkspaceSessionRecord,
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    supersedeInFlightSessionCreation(pendingSessionId);
    commitSupersededSessionCreation(pendingSessionId);
    removeSessionRecord(pendingSessionId);
    createGate.resolve({
      id: "runtime-superseded-retained",
      workspaceId: "workspace-1",
      agentKind: "claude",
      modelId: "sonnet",
      status: "idle",
    });

    await expect(materialization).resolves.toBe(pendingSessionId);
    expect(getSessionRecord(pendingSessionId)?.materializedSessionId)
      .toBe("runtime-superseded-retained");
    expect(upsertWorkspaceSessionRecord).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({ id: "runtime-superseded-retained" }),
    );
    expect(mocks.applySessionLaunchDefaults).not.toHaveBeenCalled();
    unregister();
    removeSessionRecord(pendingSessionId);
  });

  it("retires a superseded runtime while launch defaults are still pending", async () => {
    const pendingSessionId = "pending-blocked-defaults";
    const projectedRecord = createEmptySessionRecord(pendingSessionId, "claude", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "sonnet",
    });
    const runtimeSession = {
      id: "runtime-blocked-defaults",
      workspaceId: "workspace-1",
      agentKind: "claude",
      modelId: "sonnet",
      status: "idle",
    };
    const defaultsGate = deferred<{
      session: typeof runtimeSession;
      liveConfig: null;
    }>();
    putSessionRecord(projectedRecord);
    mocks.createSession.mockResolvedValue(runtimeSession);
    mocks.applySessionLaunchDefaults.mockReturnValue(defaultsGate.promise);
    const unregister = registerSessionCreation(pendingSessionId);
    const materialization = materializeSessionCreation({
      trackProductEvent: vi.fn(),
      captureException: vi.fn(),
      ensureCloudAgentCatalog: vi.fn(async () => ({ agents: [] })),
      existingProjectedRecord: projectedRecord,
      frozenDefaultLiveSessionControlValuesByAgentKind: {},
      localRuntime: null,
      cloudClient: null,
      options: {
        text: "",
        agentKind: "claude",
        modelId: "sonnet",
        workspaceId: "workspace-1",
      },
      pendingSessionId,
      resolvedModeId: null,
      upsertWorkspaceSessionRecord: vi.fn(),
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() => {
      expect(mocks.applySessionLaunchDefaults).toHaveBeenCalledTimes(1);
    });

    supersedeInFlightSessionCreation(pendingSessionId);
    commitSupersededSessionCreation(pendingSessionId);
    removeSessionRecord(pendingSessionId);

    await expect(materialization).resolves.toBe(pendingSessionId);
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toContain("runtime-blocked-defaults");
    await vi.waitFor(() => {
      expect(mocks.dismissSession).toHaveBeenCalledWith(
        expect.anything(),
        "runtime-blocked-defaults",
      );
    });
    expect(getSessionRecord(pendingSessionId)).toBeNull();

    defaultsGate.resolve({ session: runtimeSession, liveConfig: null });
    unregister();
  });

  it("cleans a late runtime without publishing it when replacement wins the final-check race", async () => {
    const pendingSessionId = "pending-tail-race";
    const projectedRecord = createEmptySessionRecord(pendingSessionId, "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "gpt-5",
    });
    const runtimeSession = {
      id: "runtime-tail-race",
      workspaceId: "workspace-1",
      agentKind: "codex",
      modelId: "gpt-5",
      status: "idle",
    };
    putSessionRecord(projectedRecord);
    const createGate = deferred<typeof runtimeSession>();
    mocks.createSession.mockReturnValueOnce(createGate.promise);
    mocks.applySessionLaunchDefaults.mockResolvedValue({
      session: runtimeSession,
      liveConfig: null,
    });
    const closeSessionSlotStream = vi.fn();
    const removeWorkspaceSessionRecord = vi.fn();
    const replacementDismiss = vi.fn(async () => undefined);
    let replacement: EmptySessionReplacementTransaction | null = null;
    injectReplacementAfterFinalCheckpoint(() => {
      replacement = beginEmptySessionReplacement(
        pendingSessionId,
        "workspace-1",
        {
          closeSessionSlotStream,
          removeWorkspaceSessionRecord,
          dismissSessionMutation: { mutateAsync: replacementDismiss } as never,
          captureException: vi.fn(),
        },
      );
    });
    const trackProductEvent = vi.fn();
    const upsertWorkspaceSessionRecord = vi.fn();
    const unregister = registerSessionCreation(pendingSessionId);

    const materialization = materializeSessionCreation({
      trackProductEvent,
      captureException: vi.fn(),
      ensureCloudAgentCatalog: vi.fn(async () => ({ agents: [] })),
      existingProjectedRecord: projectedRecord,
      frozenDefaultLiveSessionControlValuesByAgentKind: {},
      localRuntime: null,
      cloudClient: null,
      options: {
        text: "",
        agentKind: "codex",
        modelId: "gpt-5",
        workspaceId: "workspace-1",
      },
      pendingSessionId,
      resolvedModeId: null,
      upsertWorkspaceSessionRecord,
      workspaceId: "workspace-1",
    });

    await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalledOnce());
    expect(replacement).toBeNull();
    createGate.resolve(runtimeSession);
    await vi.waitFor(() => expect(replacement).not.toBeNull());
    expect(closeSessionSlotStream).toHaveBeenCalledOnce();
    expect(getSessionRecord(pendingSessionId)).toBeNull();
    const commit = replacement!.commit();
    await expect(Promise.all([materialization, commit])).resolves.toEqual([
      pendingSessionId,
      "retired",
    ]);

    expect(getSessionRecord(pendingSessionId)).toBeNull();
    expect(upsertWorkspaceSessionRecord).not.toHaveBeenCalled();
    expect(trackProductEvent).not.toHaveBeenCalled();
    expect(replacementDismiss).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mocks.dismissSession).toHaveBeenCalledWith(
        expect.anything(),
        runtimeSession.id,
      );
    });
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual([runtimeSession.id]);
    expect(mocks.writeTombstones).toHaveBeenCalledWith({
      "workspace-1": [{
        runtimeSessionId: runtimeSession.id,
        suppressedSessionIds: expect.arrayContaining([
          runtimeSession.id,
          pendingSessionId,
        ]),
      }],
    });
    expect(filterReplacedSessionTombstones("workspace-1", [
      { id: runtimeSession.id },
      { id: "runtime-replacement" },
    ])).toEqual([{ id: "runtime-replacement" }]);

    // A cold renderer hydrates the durable fence before reconciling the next
    // authoritative list. The late runtime remains hidden while listed, and
    // omission clears persistence without reopening a stale in-renderer list.
    resetReplacedSessionTombstonesForTests();
    resetSessionReplacementDismissalsForTests();
    hydrateCommittedReplacedSessionTombstones({
      "workspace-1": [{
        runtimeSessionId: runtimeSession.id,
        suppressedSessionIds: [runtimeSession.id, pendingSessionId],
      }],
    });
    reconcileReplacedSessionTombstones({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    }, [{ id: runtimeSession.id }, { id: "runtime-replacement" }]);
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual([runtimeSession.id]);
    reconcileReplacedSessionTombstones({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    }, [{ id: "runtime-replacement" }]);
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual([]);
    expect(filterReplacedSessionTombstones("workspace-1", [
      { id: runtimeSession.id },
      { id: "runtime-replacement" },
    ])).toEqual([{ id: "runtime-replacement" }]);
    unregister();
  });

  it("publishes the late runtime normally when the tail-racing replacement rolls back", async () => {
    const pendingSessionId = "pending-tail-rollback";
    const projectedRecord = createEmptySessionRecord(pendingSessionId, "claude", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "sonnet",
    });
    const runtimeSession = {
      id: "runtime-tail-rollback",
      workspaceId: "workspace-1",
      agentKind: "claude",
      modelId: "sonnet",
      status: "idle",
    };
    putSessionRecord(projectedRecord);
    mocks.createSession.mockResolvedValue(runtimeSession);
    mocks.applySessionLaunchDefaults.mockResolvedValue({
      session: runtimeSession,
      liveConfig: null,
    });
    const closeSessionSlotStream = vi.fn();
    const replacementDismiss = vi.fn(async () => undefined);
    let replacement: EmptySessionReplacementTransaction | null = null;
    injectReplacementAfterFinalCheckpoint(() => {
      replacement = beginEmptySessionReplacement(
        pendingSessionId,
        "workspace-1",
        {
          closeSessionSlotStream,
          removeWorkspaceSessionRecord: vi.fn(),
          dismissSessionMutation: { mutateAsync: replacementDismiss } as never,
          captureException: vi.fn(),
        },
      );
    });
    const trackProductEvent = vi.fn();
    const upsertWorkspaceSessionRecord = vi.fn();
    const unregister = registerSessionCreation(pendingSessionId);
    const materialization = materializeSessionCreation({
      trackProductEvent,
      captureException: vi.fn(),
      ensureCloudAgentCatalog: vi.fn(async () => ({ agents: [] })),
      existingProjectedRecord: projectedRecord,
      frozenDefaultLiveSessionControlValuesByAgentKind: {},
      localRuntime: null,
      cloudClient: null,
      options: {
        text: "",
        agentKind: "claude",
        modelId: "sonnet",
        workspaceId: "workspace-1",
      },
      pendingSessionId,
      resolvedModeId: null,
      upsertWorkspaceSessionRecord,
      workspaceId: "workspace-1",
    });

    await vi.waitFor(() => expect(replacement).not.toBeNull());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    replacement!.rollback();
    await expect(materialization).resolves.toBe(pendingSessionId);

    expect(closeSessionSlotStream).toHaveBeenCalledOnce();
    expect(getSessionRecord(pendingSessionId)?.materializedSessionId)
      .toBe(runtimeSession.id);
    expect(upsertWorkspaceSessionRecord).toHaveBeenCalledWith(
      "workspace-1",
      runtimeSession,
    );
    expect(trackProductEvent).toHaveBeenCalledOnce();
    expect(replacementDismiss).not.toHaveBeenCalled();
    expect(mocks.dismissSession).not.toHaveBeenCalled();
    expect(isReplacedSessionTombstoned("workspace-1", runtimeSession.id))
      .toBe(false);
    unregister();
    removeSessionRecord(pendingSessionId);
  });
});

function injectReplacementAfterFinalCheckpoint(onCheckpoint: () => void): void {
  let checkCount = 0;
  mocks.shouldDiscardSupersededSessionCreationOverride = async (sessionId) => {
    const shouldDiscard = await mocks.actualShouldDiscardSupersededSessionCreation!(
      sessionId,
    );
    checkCount += 1;
    if (checkCount === 3) {
      onCheckpoint();
    }
    return shouldDiscard;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
