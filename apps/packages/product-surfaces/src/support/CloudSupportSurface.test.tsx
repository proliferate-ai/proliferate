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

const support = vi.hoisted(() => ({
  client: { requestJson: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CloudSupportSurface", () => {
  it("creates a zero-upload support report with app-provided context", async () => {
    support.client.requestJson.mockImplementation(async (request: CloudRequestInput) => {
      const path = request.path;
      if (path === "/v1/support/reports") {
        return {
          reportId: "report-1",
          clientJobId: supportRequestBody(request).clientJobId,
          status: "created",
          cloudDiagnosticsStatus: "not_applicable",
          serverCorrelation: serverCorrelation("report-1"),
        };
      }
      if (path === "/v1/support/reports/{report_id}/complete") {
        return { ok: true, reportId: "report-1" };
      }
      if (path === "/v1/support/reports/{report_id}/tracker") {
        return {
          ok: true,
          reportId: "report-1",
          trackerStatus: "pending",
          githubIssueUrl: null,
          linearIssueUrl: null,
        };
      }
      throw new Error(`Unexpected support endpoint: ${path}`);
    });

    renderCloudSupportSurface();

    fireEvent.change(screen.getByPlaceholderText("What happened?"), {
      target: { value: "The workspace stopped syncing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send support message" }));

    await waitFor(() => {
      expect(findRequest("/v1/support/reports/{report_id}/tracker")).toBeTruthy();
    });
    const createBody = supportRequestBody(findRequest("/v1/support/reports"));
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
      urgent: false,
      notifyMe: false,
    });
    expect(findRequest("/v1/support/reports/{report_id}/complete")).toEqual({
      method: "POST",
      path: "/v1/support/reports/{report_id}/complete",
      pathParams: { report_id: "report-1" },
      body: {
        diagnostics: null,
        attachments: [],
        packageManifest: {
          schemaVersion: 1,
          clientJobId: createBody.clientJobId,
          reportId: "report-1",
          sourceSurface: "web",
        },
      },
    });
    expect(findRequest("/v1/support/reports/{report_id}/tracker")).toEqual({
      method: "POST",
      path: "/v1/support/reports/{report_id}/tracker",
      pathParams: { report_id: "report-1" },
      query: undefined,
      headers: undefined,
      body: undefined,
      signal: undefined,
    });
    expect(screen.queryByText("Support issue sent.")).not.toBeNull();
  });

  it("reuses a pending client job id and skips completion once report is completed", async () => {
    let createAttempts = 0;
    support.client.requestJson.mockImplementation(async (request: CloudRequestInput) => {
      const path = request.path;
      if (path === "/v1/support/reports") {
        createAttempts += 1;
        if (createAttempts === 1) {
          throw new Error("network down");
        }
        return {
          reportId: "report-2",
          clientJobId: supportRequestBody(request).clientJobId,
          status: "completed",
          cloudDiagnosticsStatus: "not_applicable",
          serverCorrelation: serverCorrelation("report-2"),
        };
      }
      if (path === "/v1/support/reports/{report_id}/tracker") {
        return {
          ok: true,
          reportId: "report-2",
          trackerStatus: "completed",
          githubIssueUrl: "https://github.com/proliferate-ai/proliferate/issues/2",
          linearIssueUrl: null,
        };
      }
      throw new Error(`Unexpected support endpoint: ${path}`);
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
      expect(findRequest("/v1/support/reports/{report_id}/tracker")).toBeTruthy();
    });
    const createBodies = requests("/v1/support/reports").map((request) =>
      supportRequestBody(request)
    );
    expect(createBodies).toHaveLength(2);
    expect(createBodies[1]?.clientJobId).toBe(createBodies[0]?.clientJobId);
    expect(findRequest("/v1/support/reports/{report_id}/complete")).toBeUndefined();
    expect(findRequest("/v1/support/reports/{report_id}/tracker")).toEqual({
      method: "POST",
      path: "/v1/support/reports/{report_id}/tracker",
      pathParams: { report_id: "report-2" },
      query: undefined,
      headers: undefined,
      body: undefined,
      signal: undefined,
    });
  });
});

interface CloudRequestInput {
  method: string;
  path: string;
  pathParams?: Record<string, string>;
  query?: unknown;
  headers?: unknown;
  body?: unknown;
  signal?: unknown;
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
}

function renderCloudSupportSurface() {
  render(
    <CloudClientProvider client={support.client as unknown as ProliferateCloudClient}>
      <CloudSupportSurface
        context={{
          source: "settings",
          intent: "general",
          pathname: "/settings/support",
        }}
      />
    </CloudClientProvider>,
  );
}

function requests(path: string): CloudRequestInput[] {
  return support.client.requestJson.mock.calls
    .map((call) => call[0] as CloudRequestInput)
    .filter((request) => request.path === path);
}

function findRequest(path: string): CloudRequestInput | undefined {
  return requests(path)[0];
}

function supportRequestBody(request: CloudRequestInput | undefined): SupportReportCreateBody {
  return request?.body as SupportReportCreateBody;
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
