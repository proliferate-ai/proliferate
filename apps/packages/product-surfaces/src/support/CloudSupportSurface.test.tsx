// @vitest-environment jsdom

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
  completeSupportReportUpload: vi.fn(),
  createSupportReport: vi.fn(),
  ensureSupportReportTracker: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk", () => ({
  completeSupportReportUpload: support.completeSupportReportUpload,
  createSupportReport: support.createSupportReport,
  ensureSupportReportTracker: support.ensureSupportReportTracker,
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCloudClient: () => support.client,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CloudSupportSurface", () => {
  it("creates a zero-upload support report with app-provided context", async () => {
    support.createSupportReport.mockResolvedValue({
      reportId: "report-1",
      status: "created",
      cloudDiagnosticsStatus: "not_applicable",
      serverCorrelation: {
        reportId: "report-1",
        ownerUserId: "user-1",
        primaryTenantId: "user:user-1",
        tenantIds: ["user:user-1"],
        cloudWorkspaceIds: [],
        cloudTargetIds: [],
        anyharnessWorkspaceIds: [],
        sessionIds: [],
      },
    });
    support.completeSupportReportUpload.mockResolvedValue({ ok: true, reportId: "report-1" });
    support.ensureSupportReportTracker.mockResolvedValue({
      ok: true,
      reportId: "report-1",
      trackerStatus: "pending",
      githubIssueUrl: null,
      linearIssueUrl: null,
    });

    render(
      <CloudSupportSurface
        context={{
          source: "settings",
          intent: "general",
          pathname: "/settings/support",
        }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("What happened?"), {
      target: { value: "The workspace stopped syncing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send support message" }));

    await waitFor(() => {
      expect(support.createSupportReport).toHaveBeenCalledWith(
        {
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
        },
        support.client,
      );
    });
    expect(support.completeSupportReportUpload).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({
        diagnostics: null,
        attachments: [],
      }),
      support.client,
    );
    expect(support.ensureSupportReportTracker).toHaveBeenCalledWith("report-1", support.client);
    expect(screen.queryByText("Support issue sent.")).not.toBeNull();
  });

  it("reuses a pending client job id and skips completion once report is completed", async () => {
    support.createSupportReport
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        reportId: "report-2",
        status: "completed",
        cloudDiagnosticsStatus: "not_applicable",
        serverCorrelation: {
          reportId: "report-2",
          ownerUserId: "user-1",
          primaryTenantId: "user:user-1",
          tenantIds: ["user:user-1"],
          cloudWorkspaceIds: [],
          cloudTargetIds: [],
          anyharnessWorkspaceIds: [],
          sessionIds: [],
        },
      });
    support.ensureSupportReportTracker.mockResolvedValue({
      ok: true,
      reportId: "report-2",
      trackerStatus: "completed",
      githubIssueUrl: "https://github.com/proliferate-ai/proliferate/issues/2",
      linearIssueUrl: null,
    });

    render(
      <CloudSupportSurface
        context={{
          source: "settings",
          intent: "general",
          pathname: "/settings/support",
        }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("What happened?"), {
      target: { value: "The workspace stopped syncing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send support message" }));

    await waitFor(() => {
      expect(screen.queryByText("network down")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Send support message" }));

    await waitFor(() => {
      const firstJobId = support.createSupportReport.mock.calls[0]?.[0]?.clientJobId;
      const secondJobId = support.createSupportReport.mock.calls[1]?.[0]?.clientJobId;
      expect(secondJobId).toBe(firstJobId);
      expect(support.completeSupportReportUpload).not.toHaveBeenCalled();
      expect(support.ensureSupportReportTracker).toHaveBeenCalledWith("report-2", support.client);
    });
  });
});
