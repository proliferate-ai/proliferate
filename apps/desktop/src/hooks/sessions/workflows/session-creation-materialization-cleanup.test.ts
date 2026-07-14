import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  committedReplacedSessionTombstonesForWorkspace,
  isReplacedSessionTombstoned,
  resetReplacedSessionTombstonesForTests,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  resetSessionReplacementDismissalsForTests,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";
import { scheduleCreatedRuntimeSessionCleanup } from "./session-created-runtime-cleanup";
import { materializeSessionCreation } from "./session-creation-materialization";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
  removeSessionRecord,
} from "@/stores/sessions/session-records";
import {
  commitSupersededSessionCreation,
  registerSessionCreation,
  resetSessionCreationSupersessionForTests,
  supersedeInFlightSessionCreation,
} from "./session-creation-supersession";

const mocks = vi.hoisted(() => ({
  applySessionLaunchDefaults: vi.fn(),
  createSession: vi.fn(),
  dismissSession: vi.fn(() => new Promise<void>(() => undefined)),
  resolveDesktopRuntimeUrlForWorkspace: vi.fn(async () => "http://runtime.test"),
  writeTombstones: vi.fn(() => true),
}));

vi.mock("@/lib/access/anyharness/sessions", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/access/anyharness/sessions")>(),
  createSession: mocks.createSession,
  dismissSession: mocks.dismissSession,
}));

vi.mock("@/lib/workflows/sessions/session-launch-defaults", () => ({
  applySessionLaunchDefaults: mocks.applySessionLaunchDefaults,
}));

vi.mock("@/lib/access/anyharness/runtime-target", () => ({
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

vi.mock("@/hooks/sessions/workflows/session-creation-runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/sessions/workflows/session-creation-runtime")>(),
  resolveDesktopRuntimeUrlForWorkspace: mocks.resolveDesktopRuntimeUrlForWorkspace,
}));

vi.mock("@/lib/access/anyharness/direct-session-create-guard", () => ({
  assertDirectSessionCreateSupported: vi.fn(),
}));

vi.mock("@/lib/access/browser/session-replacement-tombstones-storage", () => ({
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

  it("releases suppression when neither persistence nor dismissal can retire the runtime", async () => {
    mocks.writeTombstones.mockReturnValue(false);
    mocks.dismissSession.mockRejectedValue(new Error("runtime unavailable"));

    await expect(scheduleCreatedRuntimeSessionCleanup({
      connection: {} as never,
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-created",
      clientSessionId: "client-created",
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
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
