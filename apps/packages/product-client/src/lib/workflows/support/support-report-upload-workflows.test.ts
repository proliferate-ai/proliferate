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
const nativeTimestamp = "2026-05-31T12:00:00.123456789+00:00";
const privateValues = {
  jobId: "job-private-identifier",
  workspaceId: "workspace-ui-private-identifier",
  anyharnessWorkspaceId: "workspace-ah-private-identifier",
  runtimeUrl: "https://runtime.private.invalid/v1",
  sessionId: "session-private-identifier",
  pathname: "/private/support/path",
  workspaceName: "Private workspace name",
  activeWorkspaceId: "active-workspace-private-identifier",
  activeSessionId: "active-session-private-identifier",
  reportId: "report-private-identifier",
  requestId: "request-private-identifier",
  ownerUserId: "owner-private-identifier",
  organizationId: "organization-private-identifier",
  primaryTenantId: "primary-tenant-private-identifier",
  tenantId: "tenant-private-identifier",
  cloudWorkspaceId: "cloud-workspace-private-identifier",
  cloudTargetId: "cloud-target-private-identifier",
  correlationWorkspaceId: "correlation-workspace-private-identifier",
  correlationSessionId: "correlation-session-private-identifier",
  attachmentId: "attachment-private-identifier",
  attachmentName: "private-diagnostic.txt",
  manifestRuntimeHome: "/Users/private/runtime-home",
  healthRuntimeHome: "/Users/private/health-home",
  logPath: "/Users/private/desktop-native.log",
  collectionError: "/Users/private/desktop-native.log: Permission denied",
} as const;

describe("buildSupportReportPackage", () => {
  it("keeps safe metadata while redacting content, identifiers, names, paths, and URLs", async () => {
    const connection: AnyHarnessResolvedConnection = {
      runtimeUrl: privateValues.runtimeUrl,
      anyharnessWorkspaceId: privateValues.anyharnessWorkspaceId,
    };
    const dependencies: SupportReportUploadDependencies = {
      now: () => now,
      collectDiagnostics: vi.fn(async () => ({
        schemaVersion: 1,
        manifest: {
          appVersion: "0.3.41",
          runtimeVersion: "0.3.41",
          runtimeStatus: "healthy",
          runtimeHome: privateValues.manifestRuntimeHome,
          platform: "darwin-arm64",
          timestamp: nativeTimestamp,
        },
        health: {
          runtimeHome: privateValues.healthRuntimeHome,
          status: "ok",
          version: "0.3.41",
        },
        logs: [{
          source: "desktop",
          path: privateValues.logPath,
          bytesRead: 42,
          truncated: false,
          text: "Authorization: Bearer runtime-log-private-token",
        }],
        collectionErrors: [
          privateValues.collectionError,
          "desktop: unavailable",
          "anyharness: unavailable",
          "future-native-error: private text",
        ],
        futurePrivateField: "runtime future private sentinel",
      })),
      resolveWorkspace: vi.fn(async () => ({
        workspaceId: privateValues.workspaceId,
        connection,
      })),
      getClient: vi.fn(() => ({
        runtime: {
          getHealth: vi.fn(),
        },
        sessions: {
          list: vi.fn(async () => [makeSession(privateValues.sessionId)]),
          get: vi.fn(async () => makeSession(privateValues.sessionId)),
          listEvents: vi.fn(async () => [makeContentEvent(privateValues.sessionId)]),
          listRawNotifications: vi.fn(async () => [makeRawNotification(privateValues.sessionId)]),
          getLiveConfig: vi.fn(async () => makeLiveConfig()),
        },
      })),
    };

    const payload = await buildSupportReportPackage(makeJob(), dependencies, {
      reportId: privateValues.reportId,
      requestId: privateValues.requestId,
      ownerUserId: privateValues.ownerUserId,
      primaryOrganizationId: privateValues.organizationId,
      primaryTenantId: privateValues.primaryTenantId,
      tenantIds: [privateValues.tenantId],
      cloudWorkspaceIds: [privateValues.cloudWorkspaceId],
      cloudTargetIds: [privateValues.cloudTargetId],
      anyharnessWorkspaceIds: [privateValues.correlationWorkspaceId],
      sessionIds: [privateValues.correlationSessionId],
    });
    const json = JSON.stringify(payload);

    for (const privateValue of [
      ...Object.values(privateValues),
      "report message secret",
      "prompt secret",
      "tool output secret",
      "raw input secret",
      "raw notification secret",
      "system prompt secret",
      "live config credential secret",
      "runtime-log-private-token",
      "future-native-error: private text",
      "runtime future private sentinel",
    ]) {
      expect(json).not.toContain(privateValue);
    }

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
    expect(payload.workspaces[0]).toMatchObject({
      requestedWorkspaceId: redacted(privateValues.workspaceId),
      anyharnessWorkspaceId: redacted(privateValues.anyharnessWorkspaceId),
      runtimeUrl: redacted(privateValues.runtimeUrl),
      sessions: [{ sessionId: redacted(privateValues.sessionId) }],
    });
    expect(payload.workspaces[0]?.sessions[0]?.rawNotifications[0]).toMatchObject({
      notification: { redacted: true },
    });
    const uploadedLiveConfig = payload.workspaces[0]?.sessions[0]?.liveConfig as {
      liveConfig?: Record<string, unknown>;
    };
    expect(uploadedLiveConfig.liveConfig).toMatchObject({
      normalizedControls: {
        model: { currentValue: "[redacted:7]" },
      },
    });
    expect(uploadedLiveConfig.liveConfig).not.toHaveProperty("systemPrompt");
    expect(uploadedLiveConfig.liveConfig).not.toHaveProperty("providerApiKey");
    expect(payload.schemaVersion).toBe(2);
    expect(payload.report.messagePresent).toBe(true);
    expect(payload.report.messageLength).toBe("report message secret".length);
    expect(payload.report).not.toHaveProperty("message");
    expect(payload.report).not.toHaveProperty("activeWorkspaceId");
    expect(payload.report).not.toHaveProperty("activeSessionId");
    expect(payload.report).not.toHaveProperty("reportOpenedAt");
    expect(payload.report).toMatchObject({
      jobId: redacted(privateValues.jobId),
      scope: {
        kind: "most_recent_workspace",
        workspaceIds: [redacted(privateValues.workspaceId)],
      },
      context: {
        source: "sidebar",
        intent: "general",
        pathname: redacted(privateValues.pathname),
        workspaceId: redacted(privateValues.workspaceId),
        workspaceName: redacted(privateValues.workspaceName),
        workspaceLocation: "local",
      },
    });
    expect(payload.correlation).toEqual({
      reportId: redacted(privateValues.reportId),
      requestId: redacted(privateValues.requestId),
      ownerUserId: redacted(privateValues.ownerUserId),
      primaryOrganizationId: redacted(privateValues.organizationId),
      primaryTenantId: redacted(privateValues.primaryTenantId),
      tenantIds: [redacted(privateValues.tenantId)],
      cloudWorkspaceIds: [redacted(privateValues.cloudWorkspaceId)],
      cloudTargetIds: [redacted(privateValues.cloudTargetId)],
      anyharnessWorkspaceIds: [redacted(privateValues.correlationWorkspaceId)],
      sessionIds: [redacted(privateValues.correlationSessionId)],
    });
    expect(payload.attachments).toEqual([{
      clientFileId: redacted(privateValues.attachmentId),
      fileName: redacted(privateValues.attachmentName),
      contentType: "text/plain",
      sizeBytes: 17,
    }]);
    expect(payload.runtimeDiagnostics).toMatchObject({
      manifest: {
        appVersion: "0.3.41",
        runtimeVersion: "0.3.41",
        runtimeStatus: "healthy",
        runtimeHome: redacted(privateValues.manifestRuntimeHome),
        platform: "darwin-arm64",
        timestamp: nativeTimestamp,
      },
      health: {
        runtimeHome: redacted(privateValues.healthRuntimeHome),
        status: "ok",
        version: "0.3.41",
      },
      logs: [{
        source: "desktop",
        path: redacted(privateValues.logPath),
        text: "Authorization: Bearer [REDACTED]",
      }],
      collectionErrors: [
        "diagnostics: unavailable",
        "desktop: unavailable",
        "anyharness: unavailable",
        "diagnostics: unavailable",
      ],
    });
    expect(payload.collectionErrors).toEqual([]);
  });

  it("uses a fixed collection error when native diagnostics collection throws", async () => {
    const dependencies: SupportReportUploadDependencies = {
      now: () => now,
      collectDiagnostics: vi.fn(async () => {
        throw new Error("runtime diagnostics private error text");
      }),
      resolveWorkspace: vi.fn(async () => {
        throw new Error("not used");
      }),
      getClient: vi.fn(() => {
        throw new Error("not used");
      }),
    };
    const job = makeJob();
    job.scope = { kind: "app_only", workspaceIds: [] };

    const payload = await buildSupportReportPackage(job, dependencies);

    expect(payload.collectionErrors).toEqual(["runtimeDiagnostics: unavailable"]);
    expect(JSON.stringify(payload)).not.toContain("runtime diagnostics private error text");
  });

  it("fails closed for malformed structured identifier and path values", async () => {
    const privateLength = "object-length-private-sentinel";
    const objectShapedString = { length: privateLength } as unknown as string;
    const numberShapedString = 73 as unknown as string;
    const booleanShapedString = false as unknown as string;
    const dependencies: SupportReportUploadDependencies = {
      now: () => now,
      collectDiagnostics: vi.fn(async () => ({
        schemaVersion: 1,
        manifest: {
          appVersion: "0.3.41",
          runtimeVersion: "0.3.41",
          runtimeStatus: "healthy",
          runtimeHome: objectShapedString,
          platform: "darwin-arm64",
          timestamp: now.toISOString(),
        },
        health: {
          runtimeHome: numberShapedString,
          status: "ok",
          version: "0.3.41",
        },
        logs: [{
          source: "desktop",
          path: objectShapedString,
          bytesRead: 0,
          truncated: false,
          text: "",
        }],
        collectionErrors: [],
      })),
      resolveWorkspace: vi.fn(async () => {
        throw new Error("not used");
      }),
      getClient: vi.fn(() => {
        throw new Error("not used");
      }),
    };
    const job = makeJob();
    job.jobId = objectShapedString;
    job.scope = { kind: "app_only", workspaceIds: [numberShapedString] };
    job.snapshot.context.pathname = booleanShapedString;
    job.snapshot.context.workspaceId = objectShapedString;
    job.snapshot.context.workspaceName = numberShapedString;
    job.attachments = [{
      clientFileId: booleanShapedString,
      fileName: objectShapedString,
      contentType: "text/plain",
      sizeBytes: 0,
    }];

    const payload = await buildSupportReportPackage(job, dependencies, {
      reportId: objectShapedString,
      requestId: booleanShapedString,
      ownerUserId: numberShapedString,
      primaryOrganizationId: objectShapedString,
      primaryTenantId: booleanShapedString,
      tenantIds: [objectShapedString],
      cloudWorkspaceIds: [numberShapedString],
      cloudTargetIds: [booleanShapedString],
      anyharnessWorkspaceIds: [objectShapedString],
      sessionIds: [numberShapedString],
    });
    const json = JSON.stringify(payload);

    expect(json).not.toContain(privateLength);
    expect(payload.report).toMatchObject({
      jobId: "[redacted]",
      scope: { workspaceIds: ["[redacted]"] },
      context: {
        pathname: "[redacted]",
        workspaceId: "[redacted]",
        workspaceName: "[redacted]",
      },
    });
    expect(payload.correlation).toEqual({
      reportId: "[redacted]",
      requestId: "[redacted]",
      ownerUserId: "[redacted]",
      primaryOrganizationId: "[redacted]",
      primaryTenantId: "[redacted]",
      tenantIds: ["[redacted]"],
      cloudWorkspaceIds: ["[redacted]"],
      cloudTargetIds: ["[redacted]"],
      anyharnessWorkspaceIds: ["[redacted]"],
      sessionIds: ["[redacted]"],
    });
    expect(payload.attachments).toMatchObject([{
      clientFileId: "[redacted]",
      fileName: "[redacted]",
    }]);
    expect(payload.runtimeDiagnostics).toMatchObject({
      manifest: { runtimeHome: "[redacted]" },
      health: { runtimeHome: "[redacted]" },
      logs: [{ path: "[redacted]" }],
    });
  });

  it("fails closed when session event and notification arrays are revoked", async () => {
    const privateValue = "revoked session array private sentinel";
    const events = Proxy.revocable([makeContentEvent(privateValue)], {});
    const notifications = Proxy.revocable([makeRawNotification(privateValue)], {});
    events.revoke();
    notifications.revoke();
    const connection: AnyHarnessResolvedConnection = {
      runtimeUrl: privateValues.runtimeUrl,
      anyharnessWorkspaceId: privateValues.anyharnessWorkspaceId,
    };
    const dependencies: SupportReportUploadDependencies = {
      now: () => now,
      collectDiagnostics: vi.fn(async () => null),
      resolveWorkspace: vi.fn(async () => ({
        workspaceId: privateValues.workspaceId,
        connection,
      })),
      getClient: vi.fn(() => ({
        runtime: { getHealth: vi.fn() },
        sessions: {
          list: vi.fn(async () => [makeSession(privateValues.sessionId)]),
          get: vi.fn(async () => makeSession(privateValues.sessionId)),
          listEvents: vi.fn(async () => (
            events.proxy as unknown as SessionEventEnvelope[]
          )),
          listRawNotifications: vi.fn(async () => (
            notifications.proxy as unknown as SessionRawNotificationEnvelope[]
          )),
          getLiveConfig: vi.fn(async () => makeLiveConfig()),
        },
      })),
    };

    const payload = await buildSupportReportPackage(makeJob(), dependencies);
    const session = payload.workspaces[0]?.sessions[0];

    expect(session?.normalizedEvents).toEqual([]);
    expect(session?.rawNotifications).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain(privateValue);
  });
});

function makeJob(): SupportReportJob {
  return {
    jobId: privateValues.jobId,
    createdAt: now.toISOString(),
    message: "report message secret",
    scope: {
      kind: "most_recent_workspace",
      workspaceIds: [privateValues.workspaceId],
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
        pathname: privateValues.pathname,
        workspaceId: privateValues.workspaceId,
        workspaceName: privateValues.workspaceName,
        workspaceLocation: "local",
      },
      defaultScope: "most_recent_workspace",
      defaultWorkspaceId: privateValues.workspaceId,
      workspaceOptions: [
        {
          id: privateValues.workspaceId,
          label: "Workspace",
          location: "local",
          anyharnessWorkspaceId: privateValues.anyharnessWorkspaceId,
        },
      ],
    },
    attachments: [{
      clientFileId: privateValues.attachmentId,
      fileName: privateValues.attachmentName,
      contentType: "text/plain",
      sizeBytes: 17,
    }],
    activeWorkspaceId: privateValues.activeWorkspaceId,
    activeSessionId: privateValues.activeSessionId,
    reportOpenedAt: "2026-05-31T10:58:00.000Z",
  };
}

function makeSession(sessionId: string): Session {
  return {
    id: sessionId,
    workspaceId: privateValues.anyharnessWorkspaceId,
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

function redacted(value: string): string {
  return `[redacted:${value.length}]`;
}
