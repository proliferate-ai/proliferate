// @vitest-environment jsdom

import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudSupportSurface } from "./CloudSupportSurface";

class TestResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}

vi.stubGlobal("ResizeObserver", TestResizeObserver);

const support = vi.hoisted(() => ({
  client: { requestJson: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CloudSupportSurface", () => {
  it("creates a zero-upload support report with app-provided context and a null clientReleaseId by default", async () => {
    support.client.requestJson.mockImplementation(async (input: RequestJsonCall) => {
      if (input.path === "/v1/support/reports") {
        return {
          reportId: "report-1",
          clientJobId: requestBody(input).clientJobId,
          status: "created",
          cloudDiagnosticsStatus: "not_applicable",
          serverCorrelation: serverCorrelation("report-1"),
        };
      }
      if (input.path === "/v1/support/reports/{report_id}/complete") {
        return { ok: true, reportId: "report-1" };
      }
      if (input.path === "/v1/support/reports/{report_id}/tracker") {
        return {
          ok: true,
          reportId: "report-1",
          trackerStatus: "pending",
          githubIssueUrl: null,
          linearIssueUrl: null,
        };
      }
      throw new Error(`Unexpected support endpoint: ${input.path}`);
    });

    renderCloudSupportSurface();

    fireEvent.change(screen.getByPlaceholderText("What happened?"), {
      target: { value: "The workspace stopped syncing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send support message" }));

    await waitFor(() => {
      expect(findCall("/v1/support/reports/{report_id}/tracker")).toBeTruthy();
    });
    const createBody = requestBody(findCall("/v1/support/reports"));
    expect(createBody).toEqual({
      clientJobId: expect.any(String),
      message: "The workspace stopped syncing.",
      sourceSurface: "web",
      context: {
        source: "settings",
        intent: "general",
        pathname: "/settings/support",
      },
      scope: {
        kind: "app_only",
        workspaceIds: [],
      },
      workspaceRefs: [],
      expectedClientUploads: {
        diagnostics: false,
        attachmentCount: 0,
      },
      publicContentConsent: true,
      kind: "bug",
      creditConsent: false,
      // No releaseId prop was passed to the surface in this test, so the
      // canonical release identifier is absent rather than a stale/guessed value.
      clientReleaseId: null,
      urgent: false,
      notifyMe: false,
    });
    expect(findCall("/v1/support/reports/{report_id}/complete")?.body).toEqual({
      diagnostics: null,
      attachments: [],
      packageManifest: {
        schemaVersion: 1,
        clientJobId: createBody.clientJobId,
        reportId: "report-1",
        sourceSurface: "web",
      },
    });
    expect(findCall("/v1/support/reports/{report_id}/complete")?.pathParams).toEqual({
      report_id: "report-1",
    });
    expect(findCall("/v1/support/reports/{report_id}/tracker")?.pathParams).toEqual({
      report_id: "report-1",
    });
    expect(screen.queryByText("Support issue sent.")).not.toBeNull();
  });

  it("forwards the app-provided releaseId as the canonical clientReleaseId", async () => {
    support.client.requestJson.mockImplementation(async (input: RequestJsonCall) => {
      if (input.path === "/v1/support/reports") {
        return {
          reportId: "report-3",
          clientJobId: requestBody(input).clientJobId,
          status: "completed",
          cloudDiagnosticsStatus: "not_applicable",
          serverCorrelation: serverCorrelation("report-3"),
        };
      }
      if (input.path === "/v1/support/reports/{report_id}/tracker") {
        return {
          ok: true,
          reportId: "report-3",
          trackerStatus: "pending",
          githubIssueUrl: null,
          linearIssueUrl: null,
        };
      }
      throw new Error(`Unexpected support endpoint: ${input.path}`);
    });

    renderCloudSupportSurface({ releaseId: "proliferate-web@0.3.27+abcdef012345" });

    fireEvent.change(screen.getByPlaceholderText("What happened?"), {
      target: { value: "The workspace stopped syncing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send support message" }));

    await waitFor(() => {
      expect(findCall("/v1/support/reports/{report_id}/tracker")).toBeTruthy();
    });
    const createBody = requestBody(findCall("/v1/support/reports"));
    expect(createBody.clientReleaseId).toBe("proliferate-web@0.3.27+abcdef012345");
  });

  it("reuses a pending client job id and skips completion once report is completed", async () => {
    let createAttempts = 0;
    support.client.requestJson.mockImplementation(async (input: RequestJsonCall) => {
      if (input.path === "/v1/support/reports") {
        createAttempts += 1;
        if (createAttempts === 1) {
          throw new Error("network down");
        }
        return {
          reportId: "report-2",
          clientJobId: requestBody(input).clientJobId,
          status: "completed",
          cloudDiagnosticsStatus: "not_applicable",
          serverCorrelation: serverCorrelation("report-2"),
        };
      }
      if (input.path === "/v1/support/reports/{report_id}/tracker") {
        return {
          ok: true,
          reportId: "report-2",
          trackerStatus: "completed",
          githubIssueUrl: "https://github.com/proliferate-ai/proliferate/issues/2",
          linearIssueUrl: null,
        };
      }
      throw new Error(`Unexpected support endpoint: ${input.path}`);
    });

    renderCloudSupportSurface();

    fireEvent.change(screen.getByPlaceholderText("What happened?"), {
      target: { value: "The workspace stopped syncing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send support message" }));

    await waitFor(() => {
      expect(screen.queryByText("network down")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Send support message" }));

    await waitFor(() => {
      expect(findCall("/v1/support/reports/{report_id}/tracker")).toBeTruthy();
    });
    const createBodies = calls("/v1/support/reports").map((call) => requestBody(call));
    expect(createBodies).toHaveLength(2);
    expect(createBodies[1]?.clientJobId).toBe(createBodies[0]?.clientJobId);
    expect(findCall("/v1/support/reports/{report_id}/complete")).toBeUndefined();
    expect(findCall("/v1/support/reports/{report_id}/tracker")?.pathParams).toEqual({
      report_id: "report-2",
    });
  });
});

interface RequestJsonCall {
  method: string;
  path: string;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  body?: unknown;
}

interface SupportReportCreateBody {
  clientJobId: string;
  message: string;
  sourceSurface: string;
  context: unknown;
  scope: unknown;
  workspaceRefs: unknown[];
  expectedClientUploads: unknown;
  publicContentConsent: boolean;
  clientReleaseId?: string | null;
}

function renderCloudSupportSurface(options?: { releaseId?: string | null }) {
  render(
    <CloudClientProvider client={support.client as unknown as ProliferateCloudClient}>
      <CloudSupportSurface
        context={{
          source: "settings",
          intent: "general",
          pathname: "/settings/support",
        }}
        releaseId={options?.releaseId}
      />
    </CloudClientProvider>,
  );
}

function calls(path: string): RequestJsonCall[] {
  return support.client.requestJson.mock.calls
    .map((call: unknown[]) => call[0] as RequestJsonCall)
    .filter((call: RequestJsonCall) => call.path === path);
}

function findCall(path: string): RequestJsonCall | undefined {
  return calls(path)[0];
}

function requestBody(call: RequestJsonCall | undefined): SupportReportCreateBody {
  return call?.body as SupportReportCreateBody;
}

function serverCorrelation(reportId: string) {
  return {
    reportId,
    ownerUserId: "user-1",
    primaryTenantId: "user:user-1",
    tenantIds: ["user:user-1"],
    cloudWorkspaceIds: [],
    cloudTargetIds: [],
    anyharnessWorkspaceIds: [],
    sessionIds: [],
  };
}
