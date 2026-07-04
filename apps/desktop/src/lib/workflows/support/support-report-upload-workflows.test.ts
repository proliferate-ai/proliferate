import { describe, expect, it, vi } from "vitest";
import type {
  GetSessionLiveConfigResponse,
  Session,
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";
import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { SupportReportJob } from "@/lib/domain/support/report-types";
import {
  buildSupportReportPackage,
  type SupportReportUploadDependencies,
} from "@/lib/workflows/support/support-report-upload-workflows";

const now = new Date("2026-05-31T12:00:00.000Z");

describe("buildSupportReportPackage", () => {
  it("uploads full content without redacting prompts, events, notifications, or live-config", async () => {
    const sessionId = "session-full";
    const connection: AnyHarnessResolvedConnection = {
      runtimeUrl: "http://127.0.0.1:7007",
      anyharnessWorkspaceId: "workspace-ah",
    };
    const dependencies: SupportReportUploadDependencies = {
      now: () => now,
      collectDiagnostics: vi.fn(async () => null),
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

    // Full content is included (no redaction).
    expect(json).toContain("prompt secret");
    expect(json).toContain("tool output secret");
    expect(json).toContain("raw notification secret");
    expect(json).toContain("system prompt secret");

    // Pending prompts include full text.
    expect(payload.workspaces[0]?.sessions[0]?.summary).toMatchObject({
      pendingPrompts: [{ text: "prompt secret" }],
    });

    // Raw notifications pass through unredacted.
    expect(payload.workspaces[0]?.sessions[0]?.rawNotifications[0]).toMatchObject({
      notification: { text: "raw notification secret" },
    });

    // Live config includes full system prompt.
    expect(payload.workspaces[0]?.sessions[0]?.liveConfig).toMatchObject({
      liveConfig: {
        systemPrompt: "system prompt secret",
        normalizedControls: {
          model: { currentValue: "gpt-5.4" },
        },
      },
    });

    // Schema version is 3.
    expect(payload.schemaVersion).toBe(3);

    // activeWorkspaceId and reportOpenedAt are captured.
    expect(payload.report.activeWorkspaceId).toBe("workspace-ui");
    expect(payload.report.reportOpenedAt).toBe(now.toISOString());
  });
});

function makeJob(): SupportReportJob {
  return {
    jobId: "job-1",
    createdAt: now.toISOString(),
    message: "help",
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
      normalizedControls: {
        model: { currentValue: "gpt-5.4" },
      },
    },
  } as unknown as GetSessionLiveConfigResponse;
}
