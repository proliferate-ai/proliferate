/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportMessageContext } from "@/lib/access/cloud/support";
import { SettingsSidebar } from "@/components/settings/sidebar/SettingsSidebar";
import { requestSupportDialog } from "@/lib/infra/support/support-dialog-request";

const supportDialogRender = vi.hoisted(() => vi.fn());

vi.mock("@/components/support/SupportDialog", () => ({
  SupportDialog: (props: {
    onClose: () => void;
    context: SupportMessageContext;
  }) => {
    supportDialogRender(props);
    return (
      <div data-testid="support-dialog">
        <button type="button" onClick={props.onClose}>
          Close support
        </button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSettingsSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/settings?section=general"]}>
        <SettingsSidebar
          activeSection="general"
          onNavigateHome={vi.fn()}
          onSelectSection={vi.fn()}
          onCheckForUpdates={vi.fn()}
          onDownloadUpdate={vi.fn()}
          onOpenRestartPrompt={vi.fn()}
          updateActionState={{
            availableVersion: null,
            downloadProgress: null,
            isChecking: false,
            hasAvailableUpdate: false,
            phase: "idle",
            updatesSupported: true,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsSidebar support mount boundary", () => {
  it("does not mount SupportDialog until Support is opened", async () => {
    renderSettingsSidebar();

    expect(supportDialogRender).not.toHaveBeenCalled();
    expect(screen.queryByTestId("support-dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Support" }));

    expect(supportDialogRender).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("support-dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close support" }));

    await waitFor(() => {
      expect(screen.queryByTestId("support-dialog")).toBeNull();
    });
  });

  it("opens SupportDialog from the global support request", () => {
    renderSettingsSidebar();

    expect(screen.queryByTestId("support-dialog")).toBeNull();

    act(() => {
      requestSupportDialog();
    });

    expect(supportDialogRender).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("support-dialog")).toBeTruthy();
  });
});
