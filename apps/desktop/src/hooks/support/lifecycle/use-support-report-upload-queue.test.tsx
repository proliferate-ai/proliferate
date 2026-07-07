/* @vitest-environment jsdom */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SupportReportCompleteRequest,
  SupportReportCreateRequest,
} from "@proliferate/cloud-sdk/types";
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
    status: "created",
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
  ensureSupportReportTracker: vi.fn(async () => ({
    ok: true,
    reportId: "report-1",
    trackerStatus: "pending",
    githubIssueUrl: null,
    linearIssueUrl: null,
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
    await waitFor(() => {
      expect(cloudSupportMocks.completeSupportReportUpload).toHaveBeenCalledTimes(1);
    });
  });

  it("drops a transient job that has spent its attempt budget", async () => {
    cloudSupportMocks.createSupportReport.mockRejectedValueOnce(
      new Error("Upload failed with 503."),
    );
    // Fresh createdAt so the AGE backstop can't fire — this isolates the
    // transient attempt cap (attemptCount 7 -> 8 on this failed attempt).
    window.localStorage.setItem(
      "proliferate.supportReportJobs.v1",
      JSON.stringify([
        {
          job: makeSupportReportJob("job-capped", recentIso()),
          attemptCount: 7,
          nextAttemptAt: null,
        },
      ]),
    );

    renderHook(() => useSupportReportUploadQueue());

    await waitFor(() => {
      const raw = window.localStorage.getItem("proliferate.supportReportJobs.v1");
      expect(JSON.parse(raw ?? "[]")).toHaveLength(0);
    });
    expect(toastStoreMocks.show).toHaveBeenCalledWith(
      "Couldn't send your report after several tries. Please try again from Help.",
    );
  });

  it("keeps a fresh blocked-on-sign-in report queued past the attempt budget", async () => {
    cloudSupportMocks.createSupportReport.mockRejectedValueOnce(
      Object.assign(new Error("You must sign in."), { status: 401, code: "unauthorized" }),
    );
    // Fresh + far over the attempt budget: proves auth_required is exempt from
    // the attempt cap (only age would drop it).
    window.localStorage.setItem(
      "proliferate.supportReportJobs.v1",
      JSON.stringify([
        {
          job: makeSupportReportJob("job-blocked", recentIso()),
          attemptCount: 20,
          nextAttemptAt: null,
        },
      ]),
    );

    renderHook(() => useSupportReportUploadQueue());

    await waitFor(() => {
      expect(diagnosticsMocks.logRendererEvent).toHaveBeenCalledWith({
        source: "support_report_upload",
        message: "failed.auth_required",
      });
    });
    // Classified as auth_required AND still queued — the cap did not drop it.
    const raw = window.localStorage.getItem("proliferate.supportReportJobs.v1");
    expect(JSON.parse(raw ?? "[]")).toHaveLength(1);
  });

  it("drops a blocked report once it ages past the backstop", async () => {
    cloudSupportMocks.createSupportReport.mockRejectedValueOnce(
      Object.assign(new Error("You must sign in."), { status: 401, code: "unauthorized" }),
    );
    // Stale createdAt (the fixture default is 2026-05-31, > 48h ago): even a
    // blocked state is dropped by the age backstop so nothing retries forever.
    window.localStorage.setItem(
      "proliferate.supportReportJobs.v1",
      JSON.stringify([
        { job: makeSupportReportJob("job-stale-auth"), attemptCount: 1, nextAttemptAt: null },
      ]),
    );

    renderHook(() => useSupportReportUploadQueue());

    await waitFor(() => {
      const raw = window.localStorage.getItem("proliferate.supportReportJobs.v1");
      expect(JSON.parse(raw ?? "[]")).toHaveLength(0);
    });
    expect(toastStoreMocks.show).toHaveBeenCalledWith(
      "Couldn't send your report after several tries. Please try again from Help.",
    );
  });

  it("drops the job and warns the user when upload-targets reports a conflict", async () => {
    cloudSupportMocks.createSupportReportUploadTargets.mockRejectedValueOnce(
      Object.assign(
        new Error("Support report upload targets already exist for different objects."),
        { code: "support_report_upload_conflict" },
      ),
    );

    renderHook(() => useSupportReportUploadQueue());

    await waitFor(() => {
      expect(activeListeners()).toHaveLength(1);
    });
    activeListeners()[0]?.handler(makeSupportReportJob("job-conflict", recentIso()));

    await waitFor(() => {
      const raw = window.localStorage.getItem("proliferate.supportReportJobs.v1");
      expect(JSON.parse(raw ?? "[]")).toHaveLength(0);
    });
    // Terminal conflict shows the actionable copy, NOT the "already sent" success.
    expect(toastStoreMocks.show).toHaveBeenCalledWith(
      "This report can no longer be sent. Start a new report from Help if you still need support.",
    );
  });

  it("clears the job quietly when upload-targets reports the report already completed", async () => {
    cloudSupportMocks.createSupportReportUploadTargets.mockRejectedValueOnce(
      Object.assign(new Error("Support report upload is already completed."), {
        code: "support_report_already_completed",
      }),
    );

    renderHook(() => useSupportReportUploadQueue());

    await waitFor(() => {
      expect(activeListeners()).toHaveLength(1);
    });
    activeListeners()[0]?.handler(makeSupportReportJob("job-already-done"));

    await waitFor(() => {
      const raw = window.localStorage.getItem("proliferate.supportReportJobs.v1");
      expect(JSON.parse(raw ?? "[]")).toHaveLength(0);
    });
    expect(toastStoreMocks.show).toHaveBeenCalledWith(
      "Report already sent. Support has the details.",
      "info",
    );
  });

  it("skips diagnostics and completes directly when logs are excluded and there are no attachments", async () => {
    renderHook(() => useSupportReportUploadQueue());

    await waitFor(() => {
      expect(activeListeners()).toHaveLength(1);
    });

    const job = makeSupportReportJob("job-no-logs", recentIso());
    job.includeLogs = false;
    activeListeners()[0]?.handler(job);

    await waitFor(() => {
      expect(cloudSupportMocks.completeSupportReportUpload).toHaveBeenCalledTimes(1);
    });
    // No diagnostics collected, no upload targets requested, complete carries no
    // diagnostics object.
    expect(uploadWorkflowMocks.buildSupportReportPackage).not.toHaveBeenCalled();
    expect(cloudSupportMocks.createSupportReportUploadTargets).not.toHaveBeenCalled();
    const completeArgs = cloudSupportMocks.completeSupportReportUpload.mock.calls[0] as
      unknown as [string, SupportReportCompleteRequest];
    expect(completeArgs[1].diagnostics ?? null).toBeNull();

    // Create request declared diagnostics=false.
    const createArgs = cloudSupportMocks.createSupportReport.mock.calls[0] as
      unknown as [SupportReportCreateRequest];
    expect(createArgs[0].expectedClientUploads?.diagnostics).toBe(false);
  });

  it("cleans up a queued job when create returns an already completed report", async () => {
    cloudSupportMocks.createSupportReport.mockResolvedValueOnce({
      reportId: "report-1",
      status: "completed",
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
    });
    renderHook(() => useSupportReportUploadQueue());

    await waitFor(() => {
      expect(activeListeners()).toHaveLength(1);
    });

    activeListeners()[0]?.handler(makeSupportReportJob("job-completed"));

    await waitFor(() => {
      expect(cloudSupportMocks.createSupportReport).toHaveBeenCalledTimes(1);
      expect(cloudSupportMocks.createSupportReportUploadTargets).not.toHaveBeenCalled();
      expect(cloudSupportMocks.completeSupportReportUpload).not.toHaveBeenCalled();
    });
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

function recentIso(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

function makeSupportReportJob(
  jobId: string,
  createdAt = "2026-05-31T12:00:00.000Z",
): SupportReportJob {
  return {
    jobId,
    createdAt,
    message: "Help",
    scope: {
      kind: "app_only",
      workspaceIds: [],
    },
    publicContentConsent: false,
    kind: "bug",
    creditConsent: false,
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
