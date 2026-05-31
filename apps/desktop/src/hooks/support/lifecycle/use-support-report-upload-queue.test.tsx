/* @vitest-environment jsdom */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSupportReportUploadQueue } from "@/hooks/support/lifecycle/use-support-report-upload-queue";
import type { SupportReportJob } from "@/lib/domain/support/report-types";

const anyHarnessMocks = vi.hoisted(() => ({
  workspaceId: "workspace-1" as string | null,
  resolveConnection: vi.fn(async () => ({
    runtimeUrl: "http://127.0.0.1:7777",
    anyharnessWorkspaceId: "workspace-1",
  })),
  resolveWorkspaceConnectionFromContext: vi.fn(async () => ({
    workspaceId: "workspace-1",
    connection: {
      runtimeUrl: "http://127.0.0.1:7777",
      anyharnessWorkspaceId: "workspace-1",
    },
  })),
}));

const cloudSupportMocks = vi.hoisted(() => ({
  completeSupportReportUpload: vi.fn(async () => {}),
  createSupportReport: vi.fn(async () => ({
    reportId: "report-1",
    cloudDiagnosticsStatus: "not_applicable",
    serverCorrelation: {
      reportId: "report-1",
      requestId: "request-1",
      ownerUserId: "user-1",
      primaryOrganizationId: null,
      primaryTenantId: "user:user-1",
      tenantIds: ["user:user-1"],
      cloudWorkspaceIds: [],
      cloudTargetIds: [],
      anyharnessWorkspaceIds: [],
      sessionIds: [],
    },
  })),
  createSupportReportUploadTargets: vi.fn(async () => ({
    reportId: "report-1",
    diagnostics: {
      objectKey: "support/reports/report-1/diagnostics.json",
      putUrl: "https://uploads.example.test/diagnostics",
      contentType: "application/json",
      headers: {},
    },
    attachments: [],
  })),
}));

const diagnosticsMocks = vi.hoisted(() => ({
  collectSupportDiagnostics: vi.fn(async () => null),
  logRendererEvent: vi.fn(async () => {}),
}));

const supportAccessMocks = vi.hoisted(() => ({
  deleteStagedSupportReportAttachment: vi.fn(async () => {}),
  listenSupportReportJobs: vi.fn(),
  listeners: [] as Array<{
    active: boolean;
    handler: (job: SupportReportJob) => void;
    unlisten: ReturnType<typeof vi.fn>;
  }>,
  readStagedSupportReportAttachment: vi.fn(async () => ""),
}));

const uploadWorkflowMocks = vi.hoisted(() => ({
  buildSupportReportPackage: vi.fn(async () => ({
    generatedAt: "2026-05-31T12:00:00.000Z",
  })),
}));

const telemetryMocks = vi.hoisted(() => ({
  getSupportReportTelemetryRefs: vi.fn(() => ({})),
  trackProductEvent: vi.fn(),
}));

const toastStoreMocks = vi.hoisted(() => ({
  show: vi.fn(),
}));

const localStorageMock = createLocalStorageMock();

vi.mock("@anyharness/sdk-react", () => ({
  resolveWorkspaceConnectionFromContext: anyHarnessMocks.resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext: () => ({
    workspaceId: anyHarnessMocks.workspaceId,
    resolveConnection: anyHarnessMocks.resolveConnection,
  }),
}));

vi.mock("@proliferate/cloud-sdk/client/support", () => cloudSupportMocks);

vi.mock("@/lib/access/tauri/diagnostics", () => diagnosticsMocks);

vi.mock("@/lib/access/tauri/support", () => supportAccessMocks);

vi.mock("@/lib/access/anyharness/debug-client", () => ({
  createSessionDebugClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/integrations/telemetry/client", () => telemetryMocks);

vi.mock("@/lib/workflows/support/support-report-upload-workflows", () => uploadWorkflowMocks);

vi.mock("@/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (selector: (state: { runtimeUrl: string }) => unknown) =>
    selector({ runtimeUrl: "http://127.0.0.1:7777" }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof toastStoreMocks.show }) => unknown) =>
    selector({ show: toastStoreMocks.show }),
}));

describe("useSupportReportUploadQueue", () => {
  beforeEach(() => {
    anyHarnessMocks.workspaceId = "workspace-1";
    supportAccessMocks.listeners.length = 0;
    supportAccessMocks.listenSupportReportJobs.mockImplementation(
      async (handler: (job: SupportReportJob) => void) => {
        const entry = {
          active: true,
          handler,
          unlisten: vi.fn(),
        };
        entry.unlisten.mockImplementation(() => {
          entry.active = false;
        });
        supportAccessMocks.listeners.push(entry);
        return entry.unlisten;
      },
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("unsubscribes the previous report listener when queue dependencies change", async () => {
    const rendered = renderHook(() => useSupportReportUploadQueue());

    await waitFor(() => {
      expect(supportAccessMocks.listeners).toHaveLength(1);
    });

    anyHarnessMocks.workspaceId = "workspace-2";
    rendered.rerender();

    await waitFor(() => {
      expect(supportAccessMocks.listeners).toHaveLength(2);
      expect(supportAccessMocks.listeners[0]?.active).toBe(false);
      expect(supportAccessMocks.listeners[0]?.unlisten).toHaveBeenCalledTimes(1);
      expect(activeListeners()).toHaveLength(1);
    });
  });

  it("shows one sending toast when the same support job is delivered twice", async () => {
    renderHook(() => useSupportReportUploadQueue());

    await waitFor(() => {
      expect(activeListeners()).toHaveLength(1);
    });

    const [listener] = activeListeners();
    const job = makeSupportReportJob("job-1");
    listener?.handler(job);
    listener?.handler(job);

    expect(sendingToastCalls()).toHaveLength(1);
  });
});

function activeListeners() {
  return supportAccessMocks.listeners.filter((listener) => listener.active);
}

function sendingToastCalls() {
  return toastStoreMocks.show.mock.calls.filter(([message, type]) =>
    message === "Sending report..." && type === "info"
  );
}

function makeSupportReportJob(jobId: string): SupportReportJob {
  return {
    jobId,
    createdAt: "2026-05-31T12:00:00.000Z",
    message: "Help",
    scope: {
      kind: "app_only",
      workspaceIds: [],
    },
    snapshot: {
      openedAt: "2026-05-31T12:00:00.000Z",
      source: "sidebar",
      context: {
        source: "sidebar",
        intent: "general",
      },
      defaultScope: "app_only",
      defaultWorkspaceId: null,
      workspaceOptions: [],
    },
    attachments: [],
  };
}

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => {
      values.clear();
    }),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
