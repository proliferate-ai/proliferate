import { beforeEach, expect, it, vi } from "vitest";
import { materializeSessionCreation } from "#product/hooks/sessions/workflows/session-creation-materialization";
import {
  createEmptySessionRecord,
  putSessionRecord,
  removeSessionRecord,
} from "#product/stores/sessions/session-records";

const mocks = vi.hoisted(() => ({
  applySessionLaunchDefaults: vi.fn(),
  createSession: vi.fn(),
  dismissSession: vi.fn(),
}));

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

vi.mock("#product/lib/access/anyharness/direct-session-create-guard", () => ({
  assertDirectSessionCreateSupported: vi.fn(),
}));

vi.mock("#product/hooks/sessions/workflows/session-creation-runtime", () => ({
  resolveDesktopRuntimeUrlForWorkspace: vi.fn(async () => "http://runtime.test"),
}));

beforeEach(() => {
  mocks.applySessionLaunchDefaults.mockReset();
  mocks.createSession.mockReset();
  mocks.dismissSession.mockReset();
});

it("sends the durable runtime id and acknowledges it before launch defaults", async () => {
  const pendingSessionId = "client-session:claude:resume";
  const runtimeSessionId = "01234567-89ab-4def-8123-456789abcdef";
  const projectedRecord = createEmptySessionRecord(pendingSessionId, "claude", {
    workspaceId: "workspace-1",
    materializedSessionId: null,
    modelId: "sonnet",
  });
  const runtimeSession = {
    id: runtimeSessionId,
    workspaceId: "workspace-1",
    agentKind: "claude",
    modelId: "sonnet",
    status: "idle",
  };
  const acknowledged = vi.fn(async () => undefined);
  const defaults = deferred<typeof runtimeSession>();
  putSessionRecord(projectedRecord);
  mocks.createSession.mockResolvedValue(runtimeSession);
  mocks.applySessionLaunchDefaults.mockReturnValue(defaults.promise);

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
      runtimeSessionId,
    },
    pendingSessionId,
    resolvedModeId: null,
    upsertWorkspaceSessionRecord: vi.fn(),
    workspaceId: "workspace-1",
    onRuntimeSessionCreated: acknowledged,
  });

  await vi.waitFor(() => expect(mocks.applySessionLaunchDefaults).toHaveBeenCalledOnce());
  expect(mocks.createSession.mock.calls[0]?.[1])
    .toEqual(expect.objectContaining({ sessionId: runtimeSessionId }));
  expect(acknowledged).toHaveBeenCalledWith(runtimeSession);
  defaults.resolve({ session: runtimeSession, liveConfig: null });
  await expect(materialization).resolves.toBe(pendingSessionId);
  removeSessionRecord(pendingSessionId);
});

it("retires the created runtime when durable acknowledgement fails", async () => {
  const pendingSessionId = "client-session:claude:ack-failed";
  const runtimeSessionId = "11234567-89ab-4def-8123-456789abcdef";
  const projectedRecord = createEmptySessionRecord(pendingSessionId, "claude", {
    workspaceId: "workspace-1",
    materializedSessionId: null,
    modelId: "sonnet",
  });
  const runtimeSession = {
    id: runtimeSessionId,
    workspaceId: "workspace-1",
    agentKind: "claude",
    modelId: "sonnet",
    status: "idle",
  };
  putSessionRecord(projectedRecord);
  mocks.createSession.mockResolvedValue(runtimeSession);
  mocks.dismissSession.mockResolvedValue(undefined);

  await expect(materializeSessionCreation({
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
      runtimeSessionId,
    },
    pendingSessionId,
    resolvedModeId: null,
    upsertWorkspaceSessionRecord: vi.fn(),
    workspaceId: "workspace-1",
    onRuntimeSessionCreated: vi.fn(async () => {
      throw new Error("preferences unavailable");
    }),
  })).rejects.toThrow("preferences unavailable");

  expect(mocks.applySessionLaunchDefaults).not.toHaveBeenCalled();
  expect(mocks.dismissSession).toHaveBeenCalledWith(
    expect.objectContaining({ runtimeUrl: "http://runtime.test" }),
    runtimeSessionId,
  );
  removeSessionRecord(pendingSessionId);
});

function deferred<T>() {
  let resolve!: (value: { session: T; liveConfig: null }) => void;
  const promise = new Promise<{ session: T; liveConfig: null }>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
