// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DesktopWorkspaceDeepLinkPage } from "@/pages/DesktopWorkspaceDeepLinkPage";

const pageMocks = vi.hoisted(() => ({
  captureTelemetryException: vi.fn(),
  refreshCloudWorkspace: vi.fn(),
  selectWorkspaceFromSurface: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/hooks/cloud/workflows/use-cloud-workspace-actions", () => ({
  useCloudWorkspaceActions: () => ({
    refreshCloudWorkspace: pageMocks.refreshCloudWorkspace,
  }),
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    selectWorkspaceFromSurface: pageMocks.selectWorkspaceFromSurface,
  }),
}));

vi.mock("@proliferate/product-ui/auth/RedirectCallbackScreen", () => ({
  RedirectCallbackScreen: ({
    title,
    description,
    statusLabel,
    primaryAction,
    secondaryAction,
  }: any) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      <p>{statusLabel}</p>
      {primaryAction ? (
        <button type="button" onClick={primaryAction.onClick}>
          {primaryAction.label}
        </button>
      ) : null}
      {secondaryAction ? (
        <button type="button" onClick={secondaryAction.onClick}>
          {secondaryAction.label}
        </button>
      ) : null}
    </main>
  ),
}));

vi.mock("@/lib/integrations/telemetry/client", () => ({
  captureTelemetryException: pageMocks.captureTelemetryException,
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string) => void }) => unknown) =>
    selector({ show: pageMocks.showToast }),
}));

function renderDeepLinkPage(workspaceId = "workspace-1") {
  render(
    <MemoryRouter initialEntries={[`/cloud/workspaces/${workspaceId}/open`]}>
      <Routes>
        <Route
          path="/cloud/workspaces/:workspaceId/open"
          element={<DesktopWorkspaceDeepLinkPage />}
        />
        <Route path="/workspaces" element={<div>Workspaces</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DesktopWorkspaceDeepLinkPage", () => {
  beforeEach(() => {
    pageMocks.refreshCloudWorkspace.mockResolvedValue({ id: "workspace-1" });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("selects the resolved cloud workspace", async () => {
    renderDeepLinkPage();

    await waitFor(() => {
      expect(pageMocks.selectWorkspaceFromSurface).toHaveBeenCalledWith(
        "cloud:workspace-1",
        "desktop_deep_link",
      );
    });

    expect(pageMocks.captureTelemetryException).not.toHaveBeenCalled();
  });

  it("surfaces a retry when the workspace handoff stalls", async () => {
    vi.useFakeTimers();
    pageMocks.refreshCloudWorkspace.mockReturnValue(new Promise(() => undefined));

    renderDeepLinkPage();

    expect(screen.getByText("Opening workspace")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(12000);
    });

    expect(screen.getByText("Workspace did not open")).toBeTruthy();
    expect(screen.getByText("Try opening workspace again")).toBeTruthy();
    expect(pageMocks.captureTelemetryException).toHaveBeenCalledTimes(1);

    const [error, context] = pageMocks.captureTelemetryException.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Desktop workspace deep link did not finish before timeout",
    );
    expect(context).toEqual({
      level: "warning",
      tags: {
        action: "open_workspace_deep_link",
        domain: "cloud_workspace",
      },
    });
  });

  it("retries the workspace handoff after a timeout", async () => {
    vi.useFakeTimers();
    pageMocks.refreshCloudWorkspace
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce({ id: "workspace-2" });

    renderDeepLinkPage("workspace-2");

    await act(async () => {
      vi.advanceTimersByTime(12000);
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Try opening workspace again"));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(pageMocks.selectWorkspaceFromSurface).toHaveBeenCalledWith(
      "cloud:workspace-2",
      "desktop_deep_link",
    );
  });
});
