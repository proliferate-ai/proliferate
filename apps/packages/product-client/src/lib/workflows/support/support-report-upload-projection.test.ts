import { describe, expect, it, vi } from "vitest";
import type { SupportBundle } from "@proliferate/product-client/host/desktop-bridge";
import type {
  SupportReportJob,
  SupportReportServerCorrelation,
} from "#product/lib/domain/support/report-types";
import {
  buildSupportReportPackage,
  type SupportReportUploadDependencies,
} from "#product/lib/workflows/support/support-report-upload-workflows";

describe("support report upload projection", () => {
  it("fails closed for malformed scalar cycles and overridden array methods", async () => {
    const privateValue = "outer-projection-private-sentinel";
    const cycle: Record<string, unknown> = { privateValue };
    cycle.self = cycle;
    let arrayMethodReads = 0;
    const guardedArray = <T>(values: T[]): T[] => new Proxy(values, {
      get: (target, property, receiver) => {
        if (property === "slice" || property === "map") {
          arrayMethodReads += 1;
          return () => [{ raw: privateValue }];
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const diagnostics = {
      schemaVersion: cycle,
      manifest: {
        appVersion: cycle,
        runtimeVersion: cycle,
        runtimeStatus: cycle,
        runtimeHome: privateValue,
        platform: cycle,
        timestamp: cycle,
      },
      health: {
        runtimeHome: privateValue,
        status: cycle,
        version: cycle,
      },
      logs: guardedArray([{
        source: cycle,
        path: privateValue,
        bytesRead: cycle,
        truncated: cycle,
        text: `Authorization: Bearer ${privateValue}`,
      }]),
      collectionErrors: guardedArray([`${privateValue}: Permission denied`]),
      futureCycle: cycle,
    } as unknown as SupportBundle;
    const job = {
      jobId: privateValue,
      createdAt: cycle,
      message: "private message",
      scope: {
        kind: cycle,
        workspaceIds: guardedArray([privateValue]),
      },
      snapshot: {
        openedAt: cycle,
        context: {
          source: cycle,
          intent: cycle,
          pathname: privateValue,
          workspaceId: cycle,
          workspaceName: cycle,
          workspaceLocation: cycle,
        },
      },
      attachments: guardedArray([{
        clientFileId: privateValue,
        fileName: privateValue,
        contentType: cycle,
        sizeBytes: cycle,
      }]),
    } as unknown as SupportReportJob;
    const correlationList = guardedArray([privateValue]);
    const correlation = {
      reportId: privateValue,
      requestId: privateValue,
      ownerUserId: privateValue,
      primaryOrganizationId: privateValue,
      primaryTenantId: privateValue,
      tenantIds: correlationList,
      cloudWorkspaceIds: correlationList,
      cloudTargetIds: correlationList,
      anyharnessWorkspaceIds: correlationList,
      sessionIds: correlationList,
    } as SupportReportServerCorrelation;
    const dependencies: SupportReportUploadDependencies = {
      now: () => new Date("2026-07-16T12:00:00.000Z"),
      collectDiagnostics: vi.fn(async () => diagnostics),
      resolveWorkspace: vi.fn(async () => {
        throw new Error("malformed scope must fail closed to app-only");
      }),
      getClient: vi.fn(() => {
        throw new Error("malformed scope must not create a client");
      }),
    };

    const payload = await buildSupportReportPackage(job, dependencies, correlation);
    const json = JSON.stringify(payload);

    expect(json).not.toContain(privateValue);
    expect(arrayMethodReads).toBe(0);
    expect(dependencies.resolveWorkspace).not.toHaveBeenCalled();
    expect(payload.report).toMatchObject({
      createdAt: "[redacted]",
      openedAt: "[redacted]",
      scope: {
        kind: "app_only",
        workspaceIds: [`[redacted:${privateValue.length}]`],
      },
      context: {
        source: "sidebar",
        intent: "general",
        pathname: `[redacted:${privateValue.length}]`,
        workspaceId: "[redacted]",
        workspaceName: "[redacted]",
        workspaceLocation: null,
      },
    });
    expect(payload.attachments).toEqual([{
      clientFileId: `[redacted:${privateValue.length}]`,
      fileName: `[redacted:${privateValue.length}]`,
      contentType: "application/octet-stream",
      sizeBytes: 0,
    }]);
    expect(payload.correlation).toMatchObject({
      reportId: `[redacted:${privateValue.length}]`,
      tenantIds: [`[redacted:${privateValue.length}]`],
      cloudWorkspaceIds: [`[redacted:${privateValue.length}]`],
      cloudTargetIds: [`[redacted:${privateValue.length}]`],
      anyharnessWorkspaceIds: [`[redacted:${privateValue.length}]`],
      sessionIds: [`[redacted:${privateValue.length}]`],
    });
    expect(payload.runtimeDiagnostics).toMatchObject({
      schemaVersion: 0,
      manifest: {
        appVersion: "[redacted]",
        runtimeVersion: "[redacted]",
        runtimeStatus: "[redacted]",
        runtimeHome: `[redacted:${privateValue.length}]`,
        platform: "[redacted]",
        timestamp: "[redacted]",
      },
      health: {
        runtimeHome: `[redacted:${privateValue.length}]`,
        status: "[redacted]",
        version: "[redacted]",
      },
      logs: [{
        source: "diagnostics",
        path: `[redacted:${privateValue.length}]`,
        bytesRead: 0,
        truncated: false,
        text: "Authorization: Bearer [REDACTED]",
      }],
      collectionErrors: ["diagnostics: unavailable"],
    });
  });

  it("fails closed for persisted valid-string metadata while preserving useful logs", async () => {
    const privateValue = "PRIVATE_SENTINEL";
    const paddedOpaqueSecret = `${"A".repeat(46)}==`;
    const boundarySecret = "boundary-leak-123456";
    const postBoundaryLog = "useful diagnostic after truncation";
    const boundaryPrefix = `Authorization: Bearer ${boundarySecret}`;
    const boundarySuffix = `\n${postBoundaryLog}`;
    const boundaryPadding = "x".repeat(
      (2 * 1024 * 1024) - 8 - boundarySuffix.length,
    );
    const persistedJob = JSON.parse(JSON.stringify({
      jobId: "job-1",
      createdAt: privateValue,
      message: "",
      scope: { kind: "app_only", workspaceIds: [] },
      snapshot: {
        openedAt: privateValue,
        context: {
          source: "sidebar",
          intent: "general",
          pathname: null,
          workspaceId: null,
          workspaceName: null,
          workspaceLocation: null,
        },
      },
      attachments: [{
        clientFileId: "attachment-1",
        fileName: "diagnostic.txt",
        contentType: privateValue,
        sizeBytes: 12,
      }],
    })) as SupportReportJob;
    const dependencies: SupportReportUploadDependencies = {
      now: () => new Date("2026-07-16T12:00:00.000Z"),
      collectDiagnostics: vi.fn(async () => ({
        schemaVersion: 1,
        manifest: {
          appVersion: privateValue,
          runtimeVersion: privateValue,
          runtimeStatus: privateValue,
          runtimeHome: null,
          platform: privateValue,
          timestamp: privateValue,
        },
        health: {
          runtimeHome: "/safe/runtime",
          status: privateValue,
          version: privateValue,
        },
        logs: [{
          source: "desktop",
          path: "/safe/desktop.log",
          bytesRead: 128,
          truncated: false,
          text: [
            "useful ordinary runtime diagnostic",
            "Authorization: Bearer log-secret",
            "API_TOKEN=environment-secret",
            'API_TOKEN="double-quoted-secret"',
            "PASSWORD: 'single-quoted-secret'",
            `opaque=${paddedOpaqueSecret}`,
            "https://example.invalid/?signature=signed-secret",
          ].join("\n"),
        }, {
          source: "desktop",
          path: "/safe/desktop.log.1",
          bytesRead: 2 * 1024 * 1024,
          truncated: true,
          text: `${boundaryPrefix}${boundaryPadding}${boundarySuffix}`,
        }],
        collectionErrors: [],
      })),
      resolveWorkspace: vi.fn(async () => {
        throw new Error("app-only scope must not resolve workspaces");
      }),
      getClient: vi.fn(() => {
        throw new Error("app-only scope must not create a client");
      }),
    };

    const payload = await buildSupportReportPackage(persistedJob, dependencies);
    const json = JSON.stringify(payload);

    expect(json).not.toContain(privateValue);
    expect(payload.report).toMatchObject({
      createdAt: "[redacted]",
      openedAt: "[redacted]",
    });
    expect(payload.attachments[0]?.contentType).toBe("application/octet-stream");
    expect(payload.runtimeDiagnostics).toMatchObject({
      manifest: {
        appVersion: "[redacted]",
        runtimeVersion: "[redacted]",
        runtimeStatus: "[redacted]",
        platform: "[redacted]",
        timestamp: "[redacted]",
      },
      health: {
        status: "[redacted]",
        version: "[redacted]",
      },
    });
    const logText = payload.runtimeDiagnostics?.logs[0]?.text ?? "";
    expect(logText).toContain("useful ordinary runtime diagnostic");
    expect(logText).toContain("Bearer [REDACTED]");
    expect(logText).toContain("API_TOKEN=[REDACTED]");
    expect(logText).toContain("signature=[REDACTED]");
    expect(logText).not.toContain("log-secret");
    expect(logText).not.toContain("environment-secret");
    expect(logText).not.toContain("double-quoted-secret");
    expect(logText).not.toContain("single-quoted-secret");
    expect(logText).not.toContain(paddedOpaqueSecret);
    expect(logText).not.toContain("signed-secret");
    const truncatedLogText = payload.runtimeDiagnostics?.logs[1]?.text ?? "";
    expect(truncatedLogText).toBe(postBoundaryLog);
    expect(truncatedLogText).not.toContain(boundarySecret);
  });

  it("fails closed when outer package arrays are revoked", async () => {
    const privateValue = "revoked outer private sentinel";
    const revoked = Proxy.revocable([privateValue], {});
    revoked.revoke();
    const job = {
      jobId: "job-1",
      createdAt: "2026-07-16T12:00:00.000Z",
      message: "",
      scope: { kind: "app_only", workspaceIds: revoked.proxy },
      snapshot: {
        openedAt: "2026-07-16T12:00:00.000Z",
        context: { source: "sidebar", intent: "general" },
      },
      attachments: revoked.proxy,
    } as unknown as SupportReportJob;
    const diagnostics = {
      schemaVersion: 1,
      manifest: {
        appVersion: "0.3.41",
        runtimeVersion: "0.3.41",
        runtimeStatus: "healthy",
        runtimeHome: null,
        platform: "macos-aarch64",
        timestamp: "2026-07-16T12:00:00.000Z",
      },
      health: null,
      logs: revoked.proxy,
      collectionErrors: revoked.proxy,
    } as unknown as SupportBundle;
    const correlation = {
      reportId: "report-1",
      requestId: null,
      ownerUserId: "owner-1",
      primaryOrganizationId: null,
      primaryTenantId: "tenant-1",
      tenantIds: revoked.proxy,
      cloudWorkspaceIds: revoked.proxy,
      cloudTargetIds: revoked.proxy,
      anyharnessWorkspaceIds: revoked.proxy,
      sessionIds: revoked.proxy,
    } as unknown as SupportReportServerCorrelation;
    const dependencies: SupportReportUploadDependencies = {
      now: () => new Date("2026-07-16T12:00:00.000Z"),
      collectDiagnostics: vi.fn(async () => diagnostics),
      resolveWorkspace: vi.fn(async () => {
        throw new Error("app-only scope must not resolve workspaces");
      }),
      getClient: vi.fn(() => {
        throw new Error("app-only scope must not create a client");
      }),
    };

    const payload = await buildSupportReportPackage(job, dependencies, correlation);

    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(JSON.stringify(payload)).not.toContain(privateValue);
    expect(payload.report.scope.workspaceIds).toEqual([]);
    expect(payload.attachments).toEqual([]);
    expect(payload.runtimeDiagnostics?.logs).toEqual([]);
    expect(payload.runtimeDiagnostics?.collectionErrors).toEqual([]);
    expect(payload.correlation).toMatchObject({
      tenantIds: [],
      cloudWorkspaceIds: [],
      cloudTargetIds: [],
      anyharnessWorkspaceIds: [],
      sessionIds: [],
    });
  });
});
