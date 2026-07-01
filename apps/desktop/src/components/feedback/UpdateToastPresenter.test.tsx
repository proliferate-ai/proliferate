// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateToastPresenter, UPDATE_TOAST_ID } from "./UpdateToastPresenter";

const updaterMocks = vi.hoisted(() => ({
  phase: "available",
  availableVersion: "0.1.24",
  errorMessage: null as string | null,
  downloadProgress: null as number | null,
  restartPromptOpen: false,
  downloadUpdate: vi.fn(),
  openRestartPrompt: vi.fn(),
}));

const sonnerMocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { dismiss: vi.fn() });
  return { toast };
});

vi.mock("@/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updaterMocks,
}));

vi.mock("@proliferate/ui/kit/Sonner", () => ({
  toast: sonnerMocks.toast,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  updaterMocks.phase = "available";
  updaterMocks.availableVersion = "0.1.24";
  updaterMocks.errorMessage = null;
  updaterMocks.downloadProgress = null;
  updaterMocks.restartPromptOpen = false;
});

describe("UpdateToastPresenter", () => {
  it("shows the available toast with a Download action", () => {
    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).toHaveBeenCalledWith(
      "Update available",
      expect.objectContaining({
        id: UPDATE_TOAST_ID,
        description: "Proliferate 0.1.24 is ready to download.",
      }),
    );

    const options = sonnerMocks.toast.mock.calls[0]?.[1];
    options.action.onClick({ preventDefault: () => {} });
    expect(updaterMocks.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows the downloading toast without actions", () => {
    updaterMocks.phase = "downloading";
    updaterMocks.downloadProgress = 42;

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).toHaveBeenCalledWith(
      "Downloading update",
      expect.objectContaining({ id: UPDATE_TOAST_ID, action: undefined }),
    );
  });

  it("routes the ready toast's Restart action to the restart prompt", () => {
    updaterMocks.phase = "ready";

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).toHaveBeenCalledWith(
      "Restart to update",
      expect.objectContaining({
        id: UPDATE_TOAST_ID,
        description: "Proliferate 0.1.24 is installed.",
      }),
    );

    const options = sonnerMocks.toast.mock.calls[0]?.[1];
    options.action.onClick({ preventDefault: () => {} });
    expect(updaterMocks.openRestartPrompt).toHaveBeenCalledTimes(1);
  });

  it("hides the ready toast while the restart prompt is open", () => {
    updaterMocks.phase = "ready";
    updaterMocks.restartPromptOpen = true;

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).not.toHaveBeenCalled();
    expect(sonnerMocks.toast.dismiss).toHaveBeenCalledWith(UPDATE_TOAST_ID);
  });

  it("shows the error toast once per message", () => {
    updaterMocks.phase = "error";
    updaterMocks.errorMessage = "network unreachable";

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).toHaveBeenCalledWith(
      "Update failed",
      expect.objectContaining({ description: "network unreachable" }),
    );
  });

  it("dismisses the toast when the updater leaves the update flow", () => {
    updaterMocks.phase = "current";

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).not.toHaveBeenCalled();
    expect(sonnerMocks.toast.dismiss).toHaveBeenCalledWith(UPDATE_TOAST_ID);
  });
});
