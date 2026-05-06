import { describe, expect, it, vi } from "vitest";
import type {
  GetSessionLiveConfigResponse,
  HealthResponse,
  Session,
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";
import {
  copyInvestigationJsonAction,
  exportActiveSessionDebugJsonAction,
  exportWorkspaceDebugJsonAction,
  type SessionDebugActionDependencies,
  type SessionDebugActionState,
  type SessionDebugClient,
} from "@/hooks/support/use-session-debug-actions";

const now = new Date("2026-04-16T18:30:05.000Z");
const runtimeUrl = "http://127.0.0.1:7007";
const health = {
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
  capabilities: { replay: false },
  runtimeHome: "/Users/pablo/.proliferate/anyharness",
  status: "ok",
  version: "0.1.17",
} satisfies HealthResponse;

function makeSession(id: string, workspaceId = "workspace-ah"): Session {
  return {
    id,
    workspaceId,
    agentKind: "codex",
    status: "idle",
    title: "Debug session",
    modelId: "gpt-5.4",
    modeId: "default",
    actionCapabilities: { fork: false, targetedFork: false },
    nativeSessionId: "native-1",
    createdAt: "2026-04-16T18:00:00.000Z",
    updatedAt: "2026-04-16T18:20:00.000Z",
  };
}

function makeEvent(sessionId: string): SessionEventEnvelope {
  return {
    sessionId,
    seq: 1,
    timestamp: "2026-04-16T18:10:00.000Z",
    turnId: null,
    itemId: null,
    event: { type: "turn_started" },
  };
}

function makeRawNotification(sessionId: string): SessionRawNotificationEnvelope {
  return {
    sessionId,
    seq: 1,
    timestamp: "2026-04-16T18:10:01.000Z",
    notificationKind: "session/update",
    notification: { raw: true },
  };
}

function makeState(overrides: Partial<SessionDebugActionState> = {}): SessionDebugActionState {
  return {
    runtimeUrl,
    selectedWorkspaceId: "workspace-ui",
    selectedLogicalWorkspaceId: "logical-workspace",
    activeSessionId: "11111111-2222-3333-4444-555555555555",
    sessionRecords: {
      "11111111-2222-3333-4444-555555555555": {
        sessionId: "11111111-2222-3333-4444-555555555555",
        materializedSessionId: "11111111-2222-3333-4444-555555555555",
        workspaceId: "workspace-ui",
        agentKind: "codex",
        modelId: "gpt-5.4",
        modeId: "default",
        title: "Debug session",
        status: "idle",
        actionCapabilities: { fork: false, targetedFork: false },
      },
    },
    ...overrides,
  };
}

function makeClient(overrides: Partial<SessionDebugClient["sessions"]> = {}) {
  const session = makeSession("11111111-2222-3333-4444-555555555555");
  const liveConfig = { liveConfig: null } satisfies GetSessionLiveConfigResponse;
  const sessions = {
    get: vi.fn(async (sessionId: string) => makeSession(sessionId)),
    list: vi.fn(async () => [session]),
    listEvents: vi.fn(async (sessionId: string) => [makeEvent(sessionId)]),
    listRawNotifications: vi.fn(async (sessionId: string) => [makeRawNotification(sessionId)]),
    getLiveConfig: vi.fn(async () => liveConfig),
    ...overrides,
  };
  const client = {
    runtime: {
      getHealth: vi.fn(async () => health),
    },
    sessions,
  } satisfies SessionDebugClient;

  return { client, sessions };
}

function makeDependencies(client: SessionDebugClient) {
  const copyText = vi.fn(async (_value: string) => {});
  const saveDiagnosticJson = vi.fn(async (
    _suggestedFileName: string,
    _contents: string,
  ) => "/tmp/debug.json");
  const resolveWorkspace = vi.fn(async (workspaceId: string) => ({
    workspaceId,
    connection: {
      runtimeUrl,
      anyharnessWorkspaceId: "workspace-ah",
    },
  }));
  const getClient = vi.fn((_connection: { runtimeUrl: string }) => client);

  return {
    dependencies: {
      now: () => now,
      copyText,
      saveDiagnosticJson,
      resolveWorkspace,
      getClient,
    } satisfies SessionDebugActionDependencies,
    copyText,
    saveDiagnosticJson,
    resolveWorkspace,
    getClient,
  };
}

describe("session debug actions", () => {
  it("copy action produces stable pretty-printed investigation JSON", async () => {
    const { client, sessions } = makeClient();
    const { dependencies, copyText } = makeDependencies(client);

    await copyInvestigationJsonAction(makeState(), dependencies);

    expect(sessions.get).toHaveBeenCalledWith("11111111-2222-3333-4444-555555555555");
    expect(copyText).toHaveBeenCalledTimes(1);
    const copied = copyText.mock.calls[0][0];
    expect(copied).toContain('\n  "schemaVersion": 1,');
    expect(copied).toBe(JSON.stringify(JSON.parse(copied), null, 2));
    expect(JSON.parse(copied)).toMatchObject({
      workspace: {
        uiWorkspaceId: "workspace-ui",
        logicalWorkspaceId: "logical-workspace",
        anyharnessWorkspaceId: "workspace-ah",
      },
      session: {
        id: "11111111-2222-3333-4444-555555555555",
        agentKind: "codex",
      },
    });
  });

  it("active session export fetches metadata, events, raw notifications, and live config", async () => {
    const { client, sessions } = makeClient();
    const { dependencies, saveDiagnosticJson, resolveWorkspace } = makeDependencies(client);

    await exportActiveSessionDebugJsonAction(makeState({
      selectedWorkspaceId: "other-workspace",
    }), dependencies);

    expect(resolveWorkspace).toHaveBeenCalledWith("workspace-ui");
    expect(sessions.get).toHaveBeenCalledWith("11111111-2222-3333-4444-555555555555");
    expect(sessions.listEvents).toHaveBeenCalledWith("11111111-2222-3333-4444-555555555555");
    expect(sessions.listRawNotifications).toHaveBeenCalledWith("11111111-2222-3333-4444-555555555555");
    expect(sessions.getLiveConfig).toHaveBeenCalledWith("11111111-2222-3333-4444-555555555555");
    expect(saveDiagnosticJson.mock.calls[0][0]).toBe(
      "proliferate-session-debug-11111111-20260416-183005.json",
    );

    const payload = JSON.parse(saveDiagnosticJson.mock.calls[0][1]);
    expect(payload.scope).toEqual({
      kind: "session",
      id: "11111111-2222-3333-4444-555555555555",
    });
    expect(payload.sessions[0].session.id).toBe("11111111-2222-3333-4444-555555555555");
    expect(payload.sessions[0].normalizedEvents).toHaveLength(1);
    expect(payload.sessions[0].rawNotifications).toHaveLength(1);
    expect(payload.sessions[0].liveConfig).toEqual({ liveConfig: null });
  });

  it("active session export uses the materialized session id for projected records", async () => {
    const { client, sessions } = makeClient();
    const { dependencies, saveDiagnosticJson } = makeDependencies(client);

    await exportActiveSessionDebugJsonAction(makeState({
      activeSessionId: "client-session:codex:1:abc123",
      sessionRecords: {
        "client-session:codex:1:abc123": {
          sessionId: "client-session:codex:1:abc123",
          materializedSessionId: "real-session-id",
          workspaceId: "workspace-ui",
          agentKind: "codex",
          modelId: "gpt-5.4",
          modeId: "default",
          title: "Debug session",
          status: "idle",
          actionCapabilities: { fork: false, targetedFork: false },
        },
      },
    }), dependencies);

    expect(sessions.get).toHaveBeenCalledWith("real-session-id");
    expect(sessions.listEvents).toHaveBeenCalledWith("real-session-id");
    expect(sessions.listRawNotifications).toHaveBeenCalledWith("real-session-id");
    expect(sessions.getLiveConfig).toHaveBeenCalledWith("real-session-id");
    const payload = JSON.parse(saveDiagnosticJson.mock.calls[0][1]);
    expect(payload.scope).toEqual({ kind: "session", id: "real-session-id" });
  });

  it("workspace export lists sessions with includeDismissed true and exports each returned session", async () => {
    const returnedSessions = [
      makeSession("22222222-2222-3333-4444-555555555555"),
      makeSession("33333333-2222-3333-4444-555555555555"),
    ];
    const { client, sessions } = makeClient({
      list: vi.fn(async () => returnedSessions),
    });
    const { dependencies, saveDiagnosticJson } = makeDependencies(client);

    await exportWorkspaceDebugJsonAction(makeState({
      activeSessionId: null,
      sessionRecords: {},
    }), dependencies);

    expect(sessions.list).toHaveBeenCalledWith("workspace-ah", { includeDismissed: true });
    expect(sessions.get).toHaveBeenCalledWith("22222222-2222-3333-4444-555555555555");
    expect(sessions.get).toHaveBeenCalledWith("33333333-2222-3333-4444-555555555555");
    const payload = JSON.parse(saveDiagnosticJson.mock.calls[0][1]);
    expect(payload.scope).toEqual({ kind: "workspace", id: "workspace-ah" });
    expect(payload.sessions).toHaveLength(2);
  });

  it("records a failed session sub-fetch without aborting workspace export", async () => {
    const { client, sessions } = makeClient({
      listRawNotifications: vi.fn(async () => {
        throw new Error("raw fetch failed");
      }),
    });
    const { dependencies, saveDiagnosticJson } = makeDependencies(client);

    await exportWorkspaceDebugJsonAction(makeState({
      activeSessionId: null,
      sessionRecords: {},
    }), dependencies);

    expect(sessions.listRawNotifications).toHaveBeenCalled();
    expect(saveDiagnosticJson).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(saveDiagnosticJson.mock.calls[0][1]);
    expect(payload.sessions[0].rawNotifications).toBeNull();
    expect(payload.sessions[0].errors).toEqual([
      {
        scope: "rawNotifications",
        message: "raw fetch failed",
      },
    ]);
  });
});
