// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UpdateToastPresenter,
  UPDATE_TOAST_ID,
  UP_TO_DATE_TOAST_ID,
} from "./UpdateToastPresenter";

const updaterMocks = vi.hoisted(() => ({
  phase: "available",
  availableVersion: "0.1.24",
  availableTitle: "Introducing Grok" as string | null,
  errorMessage: null as string | null,
  errorSource: null as "check" | "download" | null,
  downloadProgress: null as number | null,
  restartPromptOpen: false,
  manualCheckCompletedAt: null as number | null,
  downloadUpdate: vi.fn(),
  openRestartPrompt: vi.fn(),
  clearManualCheckCompleted: vi.fn(),
}));

const appVersionMocks = vi.hoisted(() => ({
  version: "0.1.22" as string | undefined,
}));

const sonnerMocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { dismiss: vi.fn() });
  return { toast };
});

vi.mock("@/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updaterMocks,
}));

vi.mock("@/hooks/access/tauri/app/use-app-version", () => ({
  useAppVersion: () => ({ data: appVersionMocks.version }),
}));

vi.mock("@proliferate/ui/kit/Sonner", () => ({
  toast: sonnerMocks.toast,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  updaterMocks.phase = "available";
  updaterMocks.availableVersion = "0.1.24";
  updaterMocks.availableTitle = "Introducing Grok";
  updaterMocks.errorMessage = null;
  updaterMocks.errorSource = null;
  updaterMocks.downloadProgress = null;
  updaterMocks.restartPromptOpen = false;
  updaterMocks.manualCheckCompletedAt = null;
  appVersionMocks.version = "0.1.22";
});

describe("UpdateToastPresenter", () => {
  it("shows the authored release title with an UPDATE eyebrow and Download action", () => {
    render(<UpdateToastPresenter />);

    const [title, options] = sonnerMocks.toast.mock.calls[0] ?? [];
    render(<>{title}</>);

    expect(screen.getByText("UPDATE")).toBeTruthy();
    expect(screen.getByText("Introducing Grok")).toBeTruthy();
    expect(options).toEqual(
      expect.objectContaining({
        id: UPDATE_TOAST_ID,
        description: "Proliferate 0.1.24 — downloads in the background.",
      }),
    );

    options.action.onClick({ preventDefault: () => {} });
    expect(updaterMocks.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps the generic available copy when the manifest has no title", () => {
    updaterMocks.availableTitle = null;

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).toHaveBeenCalledWith(
      "Update available",
      expect.objectContaining({
        id: UPDATE_TOAST_ID,
        description: "Proliferate 0.1.24 — downloads in the background.",
      }),
    );
  });

  it.each([
    ["downloading", "Downloading update"],
    ["ready", "Restart to update"],
  ] as const)(
    "keeps the generic %s heading when the manifest has no title",
    (phase, heading) => {
      updaterMocks.phase = phase;
      updaterMocks.availableTitle = null;

      render(<UpdateToastPresenter />);

      expect(sonnerMocks.toast).toHaveBeenCalledWith(
        heading,
        expect.objectContaining({ id: UPDATE_TOAST_ID }),
      );
    },
  );

  it("supersedes the up-to-date toast when an update enters the flow", () => {
    updaterMocks.phase = "available";
    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast.dismiss).toHaveBeenCalledWith(UP_TO_DATE_TOAST_ID);
  });

  it("keeps the authored title visible while downloading", () => {
    updaterMocks.phase = "downloading";
    updaterMocks.downloadProgress = 42;

    render(<UpdateToastPresenter />);

    const [title, options] = sonnerMocks.toast.mock.calls[0] ?? [];
    render(<>{title}</>);
    render(<>{options.description}</>);

    expect(screen.getByText("UPDATE")).toBeTruthy();
    expect(screen.getByText("Introducing Grok")).toBeTruthy();
    expect(screen.getByText("Downloading Proliferate 0.1.24.")).toBeTruthy();
    expect(options).toEqual(
      expect.objectContaining({
        id: UPDATE_TOAST_ID,
        action: undefined,
      }),
    );
  });

  it("keeps the authored title visible through the Restart action", () => {
    updaterMocks.phase = "ready";

    render(<UpdateToastPresenter />);

    const [title, options] = sonnerMocks.toast.mock.calls[0] ?? [];
    render(<>{title}</>);

    expect(screen.getByText("UPDATE")).toBeTruthy();
    expect(screen.getByText("Introducing Grok")).toBeTruthy();
    expect(options).toEqual(
      expect.objectContaining({
        id: UPDATE_TOAST_ID,
        description: "Proliferate 0.1.24 is ready.",
      }),
    );

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

  it("shows connection copy when the check fails, ignoring the raw message", () => {
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "check";
    updaterMocks.errorMessage = "getaddrinfo ENOTFOUND releases.proliferate.dev";

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).toHaveBeenCalledWith(
      "Couldn't check for updates",
      expect.objectContaining({
        id: UPDATE_TOAST_ID,
        description: "Check your connection and try again.",
      }),
    );
  });

  it("keeps a short human message when the download fails", () => {
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "download";
    updaterMocks.errorMessage = "The download was interrupted.";

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).toHaveBeenCalledWith(
      "Update failed",
      expect.objectContaining({ description: "The download was interrupted." }),
    );
  });

  it("replaces machine-y download errors with fallback copy", () => {
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "download";
    updaterMocks.errorMessage =
      "Error: EACCES: permission denied, open '/Applications/Proliferate.app/Contents/MacOS/proliferate'";

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).toHaveBeenCalledWith(
      "Update failed",
      expect.objectContaining({
        description: "Something went wrong downloading the update. Try again.",
      }),
    );
  });

  it("shows the error toast once per message", () => {
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "download";
    updaterMocks.errorMessage = "network unreachable";

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).toHaveBeenCalledWith(
      "Update failed",
      expect.objectContaining({ description: "network unreachable" }),
    );
    expect(sonnerMocks.toast).toHaveBeenCalledTimes(1);
  });

  it("shows the up-to-date toast for a manual check and clears the signal", () => {
    updaterMocks.phase = "current";
    updaterMocks.manualCheckCompletedAt = Date.now();

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).toHaveBeenCalledWith(
      "You're up to date",
      expect.objectContaining({
        id: UP_TO_DATE_TOAST_ID,
        description: "Proliferate 0.1.22 is the latest.",
        duration: 4000,
      }),
    );
    expect(updaterMocks.clearManualCheckCompleted).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the phase is current without a manual-check signal", () => {
    updaterMocks.phase = "current";

    render(<UpdateToastPresenter />);

    expect(sonnerMocks.toast).not.toHaveBeenCalled();
    expect(sonnerMocks.toast.dismiss).toHaveBeenCalledWith(UPDATE_TOAST_ID);
  });
});
