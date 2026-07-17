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
      contentType: "[redacted]",
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
});
