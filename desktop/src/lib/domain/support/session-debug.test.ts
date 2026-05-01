import { describe, expect, it } from "vitest";
import type { HealthResponse, Session } from "@anyharness/sdk";
import {
  buildSessionDebugLocator,
  sessionLocatorFromSession,
  suggestSessionDebugFileName,
} from "@/lib/domain/support/session-debug";

const generatedAt = "2026-04-16T18:30:00.000Z";
const localHealth = {
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

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-12345678",
    workspaceId: "workspace-12345678",
    agentKind: "codex",
    status: "idle",
    title: "Debug session",
    modelId: "gpt-5.4",
    modeId: "default",
    nativeSessionId: "native-1",
    createdAt: "2026-04-16T18:00:00.000Z",
    updatedAt: "2026-04-16T18:20:00.000Z",
    ...overrides,
    actionCapabilities: overrides.actionCapabilities ?? { fork: false, targetedFork: false },
  };
}

describe("buildSessionDebugLocator", () => {
  it("includes local runtime home, db path, API paths, and SQLite queries", () => {
    const locator = buildSessionDebugLocator({
      generatedAt,
      runtime: {
        location: "local",
        url: "http://127.0.0.1:7007",
        health: localHealth,
      },
      workspace: {
        uiWorkspaceId: "workspace-ui",
        logicalWorkspaceId: "logical-workspace",
        anyharnessWorkspaceId: "workspace-12345678",
        owningSlotWorkspaceId: "workspace-ui",
      },
      session: sessionLocatorFromSession(makeSession()),
    });

    expect(locator.runtime.home).toBe("/Users/pablo/.proliferate/anyharness");
    expect(locator.runtime.dbPath).toBe("/Users/pablo/.proliferate/anyharness/db.sqlite");
    expect(locator.api.health).toBe("/health");
    expect(locator.api.workspaceSessions).toBe(
      "/v1/sessions?workspace_id=workspace-12345678&include_dismissed=true",
    );
    expect(locator.api.normalizedEvents).toBe("/v1/sessions/session-12345678/events");
    expect(locator.sqlite.tables).toEqual({
      sessions: "sessions",
      normalizedEvents: "session_events",
      rawNotifications: "session_raw_notifications",
      liveConfigSnapshots: "session_live_config_snapshots",
    });
    expect(locator.queries.sessions).toBe("SELECT * FROM sessions WHERE id = :session_id;");
    expect(locator.queries.sessionEvents).toContain("session_events");
    expect(locator.queries.rawNotifications).toContain("session_raw_notifications");
    expect(locator.queries.liveConfigSnapshots).toContain("session_live_config_snapshots");
  });

  it("omits dbPath and records cloud runtime location for cloud locators", () => {
    const locator = buildSessionDebugLocator({
      generatedAt,
      runtime: {
        location: "cloud",
        url: "https://runtime.example.test",
        health: {
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
          runtimeHome: "/srv/anyharness",
          status: "ok",
          version: "0.1.17",
        },
      },
      workspace: {
        uiWorkspaceId: "cloud:workspace-ui",
        logicalWorkspaceId: "logical-workspace",
        anyharnessWorkspaceId: "workspace-cloud",
        owningSlotWorkspaceId: null,
      },
    });

    expect(locator.runtime.location).toBe("cloud");
    expect(locator.runtime).not.toHaveProperty("dbPath");
    expect(locator.runtime.directSqliteAccess).toBe(false);
    expect(locator.sqlite.unavailableReason).toContain("Direct local SQLite access is unavailable");
  });

  it("includes session id, agent kind, status, and owning workspace id", () => {
    const locator = buildSessionDebugLocator({
      generatedAt,
      runtime: {
        location: "local",
        url: "http://127.0.0.1:7007",
        health: localHealth,
      },
      workspace: {
        uiWorkspaceId: "workspace-ui",
        logicalWorkspaceId: null,
        anyharnessWorkspaceId: "workspace-12345678",
        owningSlotWorkspaceId: "workspace-ui",
      },
      session: sessionLocatorFromSession(makeSession({
        agentKind: "claude",
        status: "running",
      })),
    });

    expect(locator.session).toMatchObject({
      id: "session-12345678",
      owningWorkspaceId: "workspace-12345678",
      agentKind: "claude",
      status: "running",
      actionCapabilities: { fork: false, targetedFork: false },
    });
  });

  it("does not invent a session for workspace-only locators", () => {
    const locator = buildSessionDebugLocator({
      generatedAt,
      runtime: {
        location: "local",
        url: "http://127.0.0.1:7007",
        health: localHealth,
      },
      workspace: {
        uiWorkspaceId: "workspace-ui",
        logicalWorkspaceId: null,
        anyharnessWorkspaceId: "workspace-12345678",
        owningSlotWorkspaceId: null,
      },
    });

    expect(locator.session).toBeNull();
    expect(locator.sqlite.parameters.session_id).toBeNull();
    expect(locator.api.session).toBeNull();
    expect(locator.queries.sessions).toBe(
      "SELECT * FROM sessions WHERE workspace_id = :workspace_id ORDER BY updated_at DESC;",
    );
  });
});

describe("suggestSessionDebugFileName", () => {
  it("formats session and workspace debug file names with UTC timestamps", () => {
    const date = new Date("2026-04-16T18:30:05.000Z");

    expect(suggestSessionDebugFileName("session", "session-abcdef", date)).toBe(
      "proliferate-session-debug-session-20260416-183005.json",
    );
    expect(suggestSessionDebugFileName("workspace", "workspace-abcdef", date)).toBe(
      "proliferate-workspace-debug-workspac-20260416-183005.json",
    );
  });
});
