import { describe, expect, it } from "vitest";
import type {
  ContentPart,
  HealthResponse,
  Session,
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";
import { buildSessionDebugExport } from "@/lib/domain/support/session-debug/export-models";
import { suggestSessionDebugFileName } from "@/lib/domain/support/session-debug/file-name";
import { buildSessionDebugLocator } from "@/lib/domain/support/session-debug/locator";
import {
  sanitizeSessionDebugContentParts,
  sanitizeSessionDebugExportedSession,
} from "@/lib/domain/support/session-debug/sanitizer";
import { sessionLocatorFromSession } from "@/lib/domain/support/session-debug/session-summary";

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

describe("sanitizeSessionDebugContentParts", () => {
  it("redacts textual content and resource previews without changing part shape", () => {
    const parts = [
      { type: "text", text: "abc" },
      { type: "tool_input_text", text: "input" },
      { type: "tool_result_text", text: "result" },
      {
        type: "resource",
        uri: "file:///tmp/secret.txt",
        name: "secret.txt",
        mimeType: "text/plain",
        preview: "preview",
      },
      {
        type: "file_read",
        path: "/repo/secret.txt",
        preview: "file preview",
      },
    ] satisfies ContentPart[];

    expect(sanitizeSessionDebugContentParts(parts)).toEqual([
      { type: "text", text: "[text:3]" },
      { type: "tool_input_text", text: "[text:5]" },
      { type: "tool_result_text", text: "[text:6]" },
      {
        type: "resource",
        uri: "file:///tmp/secret.txt",
        name: "secret.txt",
        mimeType: "text/plain",
        preview: "[preview:7]",
      },
      {
        type: "file_read",
        path: "/repo/secret.txt",
        preview: "file preview",
      },
    ]);
  });
});

describe("sanitizeSessionDebugExportedSession", () => {
  it("redacts pending prompts, transcript content, raw metadata, and notifications", () => {
    const rawNotification: SessionRawNotificationEnvelope = {
      sessionId: "session-12345678",
      seq: 4,
      timestamp: "2026-04-16T18:11:00.000Z",
      notificationKind: "session/update",
      notification: {
        token: "secret",
        path: "/repo/secret.txt",
      },
    };
    const sanitized = sanitizeSessionDebugExportedSession({
      session: makeSession({
        pendingPrompts: [{
          contentParts: [{ type: "text", text: "abc" }],
          promptId: "prompt-1",
          promptProvenance: null,
          queuedAt: "2026-04-16T18:09:00.000Z",
          seq: 2,
          text: "prompt",
        }],
      }),
      normalizedEvents: [
        eventEnvelope(1, {
          type: "item_completed",
          item: {
            contentParts: [{ type: "tool_result_text", text: "result" }],
            kind: "assistant_message",
            rawInput: { token: "secret" },
            rawOutput: { path: "/repo/secret.txt" },
            sourceAgentKind: "codex",
            status: "completed",
          },
        } as SessionEventEnvelope["event"]),
        eventEnvelope(2, {
          type: "item_delta",
          delta: {
            appendContentParts: [{ type: "tool_input_text", text: "input" }],
            rawInput: { command: "secret" },
            rawOutput: { output: "secret" },
            replaceContentParts: [{ type: "text", text: "replace" }],
          },
        }),
        eventEnvelope(3, {
          type: "pending_prompt_added",
          contentParts: [{ type: "text", text: "queued" }],
          promptId: "prompt-1",
          promptProvenance: null,
          queuedAt: "2026-04-16T18:09:00.000Z",
          seq: 3,
          text: "queue",
        }),
      ],
      rawNotifications: [rawNotification],
      liveConfig: null,
      errors: [],
    });

    expect(sanitized.session?.pendingPrompts).toEqual([{
      contentParts: [{ type: "text", text: "[text:3]" }],
      promptId: "prompt-1",
      promptProvenance: null,
      queuedAt: "2026-04-16T18:09:00.000Z",
      seq: 2,
      text: "[content:6]",
    }]);
    expect(sanitized.normalizedEvents?.[0].event).toEqual({
      type: "item_completed",
      item: {
        contentParts: [{ type: "tool_result_text", text: "[text:6]" }],
        kind: "assistant_message",
        rawInput: undefined,
        rawOutput: undefined,
        sourceAgentKind: "codex",
        status: "completed",
      },
    });
    expect(sanitized.normalizedEvents?.[1].event).toEqual({
      type: "item_delta",
      delta: {
        appendContentParts: [{ type: "tool_input_text", text: "[text:5]" }],
        rawInput: undefined,
        rawOutput: undefined,
        replaceContentParts: [{ type: "text", text: "[text:7]" }],
      },
    });
    expect(sanitized.normalizedEvents?.[2].event).toEqual({
      type: "pending_prompt_added",
      contentParts: [{ type: "text", text: "[text:6]" }],
      promptId: "prompt-1",
      promptProvenance: null,
      queuedAt: "2026-04-16T18:09:00.000Z",
      seq: 3,
      text: "[content:5]",
    });
    expect(sanitized.rawNotifications).toEqual([{
      ...rawNotification,
      notification: { redacted: true },
    }]);
  });
});

describe("buildSessionDebugExport", () => {
  it("keeps the export envelope stable while sanitizing sessions", () => {
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

    const payload = buildSessionDebugExport({
      generatedAt,
      scope: { kind: "session", id: "session-12345678" },
      locator,
      sessions: [{
        session: makeSession({
          pendingPrompts: [{
            contentParts: [{ type: "text", text: "secret" }],
            promptId: "prompt-1",
            promptProvenance: null,
            queuedAt: "2026-04-16T18:09:00.000Z",
            seq: 2,
            text: "secret",
          }],
        }),
        normalizedEvents: null,
        rawNotifications: [{
          sessionId: "session-12345678",
          seq: 1,
          timestamp: "2026-04-16T18:11:00.000Z",
          notificationKind: "session/update",
          notification: { token: "secret" },
        }],
        liveConfig: null,
        errors: [{ scope: "liveConfig", message: "unavailable" }],
      }],
    });

    expect(payload).toMatchObject({
      schemaVersion: 1,
      generatedAt,
      scope: { kind: "session", id: "session-12345678" },
      locator,
      errors: [],
    });
    expect(payload.sessions[0].session?.pendingPrompts?.[0].text).toBe("[content:6]");
    expect(payload.sessions[0].rawNotifications?.[0].notification).toEqual({ redacted: true });
    expect(payload.sessions[0].errors).toEqual([
      { scope: "liveConfig", message: "unavailable" },
    ]);
  });
});

function eventEnvelope(
  seq: number,
  event: SessionEventEnvelope["event"],
): SessionEventEnvelope {
  return {
    sessionId: "session-12345678",
    seq,
    timestamp: `2026-04-16T18:10:0${seq}.000Z`,
    turnId: "turn-1",
    itemId: null,
    event,
  };
}
