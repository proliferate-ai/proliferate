import { describe, expect, it, vi } from "vitest";
import type {
  GetSessionLiveConfigResponse,
  Session,
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";
import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";
import {
  buildSupportReportPackage,
  type SupportReportUploadDependencies,
} from "#product/lib/workflows/support/support-report-upload-workflows";

const now = new Date("2026-05-31T12:00:00.000Z");

describe("buildSupportReportPackage", () => {
  it("keeps diagnostic metadata while redacting report and session content", async () => {
    const sessionId = "session-redaction";
    const connection: AnyHarnessResolvedConnection = {
      runtimeUrl: "http://127.0.0.1:7007",
      anyharnessWorkspaceId: "workspace-ah",
    };
    const dependencies: SupportReportUploadDependencies = {
      now: () => now,
      collectDiagnostics: vi.fn(async () => {
        const error = new Error("runtime diagnostic private");
        error.name = "private error name";
        throw error;
      }),
      resolveWorkspace: vi.fn(async () => ({ workspaceId: "workspace-ui", connection })),
      getClient: vi.fn(() => ({
        runtime: {
          getHealth: vi.fn(),
        },
        sessions: {
          list: vi.fn(async () => [makeSession(sessionId)]),
          get: vi.fn(async () => makeSession(sessionId)),
          listEvents: vi.fn(async () => [makeContentEvent(sessionId)]),
          listRawNotifications: vi.fn(async () => [makeRawNotification(sessionId)]),
          getLiveConfig: vi.fn(async () => makeLiveConfig()),
        },
      })),
    };

    const payload = await buildSupportReportPackage(makeJob(), dependencies, {
      reportId: "report-1",
      requestId: "request-1",
      ownerUserId: "user-1",
      primaryOrganizationId: null,
      primaryTenantId: "user:user-1",
      tenantIds: ["user:user-1"],
      cloudWorkspaceIds: [],
      cloudTargetIds: [],
      anyharnessWorkspaceIds: ["workspace-ah"],
      sessionIds: [sessionId],
    });
    const json = JSON.stringify(payload);

    expect(json).not.toContain("report message secret");
    expect(json).not.toContain("prompt secret");
    expect(json).not.toContain("tool output secret");
    expect(json).not.toContain("raw input secret");
    expect(json).not.toContain("raw notification secret");
    expect(json).not.toContain("system prompt secret");
    expect(json).not.toContain("live config credential secret");
    expect(json).not.toContain("runtime diagnostic private");
    expect(json).not.toContain("private error name");

    expect(payload.workspaces[0]?.sessions[0]?.summary).toMatchObject({
      pendingPrompts: [{
        contentParts: [{ type: "text", text: "[redacted:13]" }],
        text: "[redacted:13]",
      }],
    });
    expect(payload.workspaces[0]?.sessions[0]?.normalizedEvents[0]).toMatchObject({
      event: {
        item: {
          contentParts: [{ type: "tool_result_text", text: "[redacted:18]" }],
          rawInput: { redacted: true },
          rawOutput: { redacted: true },
        },
      },
    });
    expect(payload.workspaces[0]?.sessions[0]?.rawNotifications[0]).toMatchObject({
      notification: { redacted: true },
    });
    expect(payload.workspaces[0]?.sessions[0]?.liveConfig).toMatchObject({
      liveConfig: {
        systemPrompt: "[redacted:20]",
        providerApiKey: "[REDACTED]",
        normalizedControls: {
          model: { currentValue: "[redacted:7]" },
        },
      },
    });
    expect(payload.schemaVersion).toBe(2);
    expect(payload.report.messagePresent).toBe(true);
    expect(payload.report.messageLength).toBe("report message secret".length);
    expect(payload.report).not.toHaveProperty("message");
    expect(payload.report.activeWorkspaceId).toBe("workspace-ui");
    expect(payload.report.activeSessionId).toBe("session-active");
    expect(payload.report.reportOpenedAt).toBe(now.toISOString());
    expect(payload.collectionErrors).toEqual(["runtimeDiagnostics: unavailable"]);
  });
});

function makeJob(): SupportReportJob {
  return {
    jobId: "job-1",
    createdAt: now.toISOString(),
    message: "report message secret",
    scope: {
      kind: "most_recent_workspace",
      workspaceIds: ["workspace-ui"],
    },
    publicContentConsent: false,
    kind: "bug",
    creditConsent: false,
    snapshot: {
      openedAt: now.toISOString(),
      source: "sidebar",
      context: {
        source: "sidebar",
        intent: "general",
        workspaceId: "workspace-ui",
        workspaceLocation: "local",
      },
      defaultScope: "most_recent_workspace",
      defaultWorkspaceId: "workspace-ui",
      workspaceOptions: [
        {
          id: "workspace-ui",
          label: "Workspace",
          location: "local",
          anyharnessWorkspaceId: "workspace-ah",
        },
      ],
    },
    attachments: [],
    activeWorkspaceId: "workspace-ui",
    activeSessionId: "session-active",
    reportOpenedAt: now.toISOString(),
  };
}

function makeSession(sessionId: string): Session {
  return {
    id: sessionId,
    workspaceId: "workspace-ah",
    agentKind: "codex",
    status: "idle",
    title: "Debug session",
    modelId: "gpt-5.4",
    modeId: "default",
    actionCapabilities: { fork: false, targetedFork: false },
    nativeSessionId: null,
    createdAt: "2026-05-31T11:00:00.000Z",
    updatedAt: "2026-05-31T11:30:00.000Z",
    pendingPrompts: [{
      contentParts: [{ type: "text", text: "prompt secret" }],
      promptId: "prompt-1",
      promptProvenance: null,
      queuedAt: "2026-05-31T11:31:00.000Z",
      seq: 2,
      text: "prompt secret",
    }],
  };
}

function makeContentEvent(sessionId: string): SessionEventEnvelope {
  return {
    sessionId,
    seq: 1,
    timestamp: "2026-05-31T11:32:00.000Z",
    turnId: "turn-1",
    itemId: "item-1",
    event: {
      type: "item_completed",
      item: {
        contentParts: [{ type: "tool_result_text", text: "tool output secret" }],
        kind: "tool_invocation",
        rawInput: { text: "raw input secret" },
        rawOutput: { text: "tool output secret" },
        sourceAgentKind: "codex",
        status: "completed",
      },
    } as SessionEventEnvelope["event"],
  };
}

function makeRawNotification(sessionId: string): SessionRawNotificationEnvelope {
  return {
    sessionId,
    seq: 1,
    timestamp: "2026-05-31T11:33:00.000Z",
    notificationKind: "session/update",
    notification: { text: "raw notification secret" },
  };
}

function makeLiveConfig(): GetSessionLiveConfigResponse {
  return {
    liveConfig: {
      systemPrompt: "system prompt secret",
      providerApiKey: "live config credential secret",
      normalizedControls: {
        model: { currentValue: "gpt-5.4" },
      },
    },
  } as unknown as GetSessionLiveConfigResponse;
}
