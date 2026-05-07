/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import type { SupportMessageContext } from "@/lib/access/cloud/support";

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

vi.mock("@/hooks/settings/use-app-version", () => ({
  useAppVersion: () => ({ data: "0.0.0" }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSettingsSidebar() {
  return render(
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
    </MemoryRouter>,
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
});
