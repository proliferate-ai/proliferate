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
  client: { POST: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CloudSupportSurface", () => {
  it("creates a zero-upload support report with app-provided context", async () => {
    support.client.POST.mockImplementation(async (path: string, options?: CloudPostOptions) => {
      if (path === "/v1/support/reports") {
        return {
          data: {
            reportId: "report-1",
            clientJobId: supportRequestBody(options).clientJobId,
            status: "created",
            cloudDiagnosticsStatus: "not_applicable",
            serverCorrelation: serverCorrelation("report-1"),
          },
        };
      }
      if (path === "/v1/support/reports/{report_id}/complete") {
        return { data: { ok: true, reportId: "report-1" } };
      }
      if (path === "/v1/support/reports/{report_id}/tracker") {
        return {
          data: {
            ok: true,
            reportId: "report-1",
            trackerStatus: "pending",
            githubIssueUrl: null,
            linearIssueUrl: null,
          },
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
      expect(findPostCall("/v1/support/reports/{report_id}/tracker")).toBeTruthy();
    });
    const createBody = supportRequestBody(findPostCall("/v1/support/reports")?.[1]);
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
    });
    expect(findPostCall("/v1/support/reports/{report_id}/complete")?.[1]).toEqual({
      params: {
        path: {
          report_id: "report-1",
        },
      },
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
    expect(findPostCall("/v1/support/reports/{report_id}/tracker")?.[1]).toEqual({
      params: {
        path: {
          report_id: "report-1",
        },
      },
    });
    expect(screen.queryByText("Support issue sent.")).not.toBeNull();
  });

  it("reuses a pending client job id and skips completion once report is completed", async () => {
    let createAttempts = 0;
    support.client.POST.mockImplementation(async (path: string, options?: CloudPostOptions) => {
      if (path === "/v1/support/reports") {
        createAttempts += 1;
        if (createAttempts === 1) {
          throw new Error("network down");
        }
        return {
          data: {
            reportId: "report-2",
            clientJobId: supportRequestBody(options).clientJobId,
            status: "completed",
            cloudDiagnosticsStatus: "not_applicable",
            serverCorrelation: serverCorrelation("report-2"),
          },
        };
      }
      if (path === "/v1/support/reports/{report_id}/tracker") {
        return {
          data: {
            ok: true,
            reportId: "report-2",
            trackerStatus: "completed",
            githubIssueUrl: "https://github.com/proliferate-ai/proliferate/issues/2",
            linearIssueUrl: null,
          },
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
      expect(findPostCall("/v1/support/reports/{report_id}/tracker")).toBeTruthy();
    });
    const createBodies = postCalls("/v1/support/reports").map((call) =>
      supportRequestBody(call[1])
    );
    expect(createBodies).toHaveLength(2);
    expect(createBodies[1]?.clientJobId).toBe(createBodies[0]?.clientJobId);
    expect(findPostCall("/v1/support/reports/{report_id}/complete")).toBeUndefined();
    expect(findPostCall("/v1/support/reports/{report_id}/tracker")?.[1]).toEqual({
      params: {
        path: {
          report_id: "report-2",
        },
      },
    });
  });
});

interface CloudPostOptions {
  body?: unknown;
  params?: unknown;
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

function postCalls(path: string): Array<[string, CloudPostOptions | undefined]> {
  return support.client.POST.mock.calls.filter((call): call is [string, CloudPostOptions | undefined] =>
    call[0] === path
  );
}

function findPostCall(path: string): [string, CloudPostOptions | undefined] | undefined {
  return postCalls(path)[0];
}

function supportRequestBody(options: CloudPostOptions | undefined): SupportReportCreateBody {
  return options?.body as SupportReportCreateBody;
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
