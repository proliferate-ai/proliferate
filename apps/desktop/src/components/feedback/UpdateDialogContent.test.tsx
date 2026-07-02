// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateDialogContent } from "./UpdateDialogContent";

const handlers = {
  onToggleAutoUpdate: vi.fn(),
  onSkip: vi.fn(),
  onRemindLater: vi.fn(),
  onInstall: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderContent(overrides: Partial<Parameters<typeof UpdateDialogContent>[0]> = {}) {
  return render(
    <UpdateDialogContent
      availableVersion="0.1.24"
      currentVersion="0.1.22"
      autoUpdate={false}
      {...handlers}
      {...overrides}
    />,
  );
}

describe("UpdateDialogContent", () => {
  it("renders the version compare copy", () => {
    renderContent();

    expect(screen.getByRole("heading", { name: "Update available" })).toBeTruthy();
    expect(
      screen.getByText(
        "Proliferate 0.1.24 is out — you're on 0.1.22. Download in the background and keep working.",
      ),
    ).toBeTruthy();
  });

  it("falls back when versions are unknown", () => {
    renderContent({ availableVersion: null, currentVersion: null });

    expect(
      screen.getByText(
        "A new version of Proliferate is out. Download in the background and keep working.",
      ),
    ).toBeTruthy();
  });

  it("wires the action buttons and auto-update checkbox", () => {
    renderContent();

    fireEvent.click(screen.getByRole("button", { name: "Skip this version" }));
    expect(handlers.onSkip).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(handlers.onRemindLater).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Install update" }));
    expect(handlers.onInstall).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Keep Proliferate up to date automatically"));
    expect(handlers.onToggleAutoUpdate).toHaveBeenCalledWith(true);
  });
});
