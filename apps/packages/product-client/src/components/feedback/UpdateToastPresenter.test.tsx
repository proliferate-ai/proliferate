// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToastInput } from "@proliferate/ui/utils/toast-model";
import {
  UpdateToastPresenter,
  UPDATE_TOAST_ID,
  UP_TO_DATE_TOAST_ID,
  RESTART_COUNTDOWN_TOAST_ID,
} from "#product/components/feedback/UpdateToastPresenter";

/**
 * The presenter's job is *which* toast, at *which* weight, with *which*
 * actions — the layout belongs to the kit and is asserted there. So these tests
 * read the `showToast` input rather than the rendered DOM: that is the presenter's
 * actual output, and asserting on class names here would only re-test the kit.
 */

const updaterMocks = vi.hoisted(() => ({
  phase: "available" as string,
  availableVersion: "0.1.24",
  availableTitle: "Introducing Grok" as string | null,
  errorMessage: null as string | null,
  errorSource: null as "check" | "download" | null,
  downloadProgress: null as number | null,
  lastProgressAt: null as number | null,
  downloadRetryCount: 0,
  restartPromptOpen: false,
  restartCountdownStartedAt: null as number | null,
  manualCheckCompletedAt: null as number | null,
  downloadUpdate: vi.fn(),
  retryDownload: vi.fn(),
  cancelUpdate: vi.fn(),
  skipVersion: vi.fn(),
  cancelRestartCountdown: vi.fn(),
  openRestartPrompt: vi.fn(),
  restartNow: vi.fn(),
  clearManualCheckCompleted: vi.fn(),
}));

const appVersionMocks = vi.hoisted(() => ({
  version: "0.1.22" as string | undefined,
}));

const runningMocks = vi.hoisted(() => ({ count: 0 }));

const toastMocks = vi.hoisted(() => ({
  showToast: vi.fn((_input: unknown) => "toast-id"),
  dismissToast: vi.fn(),
}));

vi.mock("#product/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updaterMocks,
}));

vi.mock("#product/hooks/access/tauri/app/use-app-version", () => ({
  useAppVersion: () => ({ data: appVersionMocks.version }),
}));

vi.mock("#product/hooks/app/lifecycle/use-running-agent-count", () => ({
  useRunningAgentCount: () => runningMocks.count,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ links: { openExternal: vi.fn() } }),
}));

vi.mock("@proliferate/ui/utils/show-toast", () => toastMocks);

function raised(): ToastInput[] {
  return toastMocks.showToast.mock.calls.map(([input]) => input as ToastInput);
}

function raisedWithId(id: string): ToastInput | undefined {
  return raised().find((input) => input.id === id);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  updaterMocks.phase = "available";
  updaterMocks.availableVersion = "0.1.24";
  updaterMocks.availableTitle = "Introducing Grok";
  updaterMocks.errorMessage = null;
  updaterMocks.errorSource = null;
  updaterMocks.downloadProgress = null;
  updaterMocks.lastProgressAt = null;
  updaterMocks.downloadRetryCount = 0;
  updaterMocks.restartPromptOpen = false;
  updaterMocks.restartCountdownStartedAt = null;
  updaterMocks.manualCheckCompletedAt = null;
  appVersionMocks.version = "0.1.22";
  runningMocks.count = 0;
});

describe("UpdateToastPresenter — which phases speak", () => {
  it.each(["checking", "downloading", "idle"] as const)(
    "stays silent during %s, because the sidebar pill owns continuous state",
    (phase) => {
      updaterMocks.phase = phase;

      render(<UpdateToastPresenter />);

      expect(toastMocks.showToast).not.toHaveBeenCalled();
      expect(toastMocks.dismissToast).toHaveBeenCalledWith(UPDATE_TOAST_ID);
    },
  );

  it("stays silent when a background check finds nothing", () => {
    updaterMocks.phase = "current";

    render(<UpdateToastPresenter />);

    expect(toastMocks.showToast).not.toHaveBeenCalled();
  });

  it("gives a manual check a short receipt and clears the one-shot signal", () => {
    updaterMocks.phase = "current";
    updaterMocks.manualCheckCompletedAt = Date.now();

    render(<UpdateToastPresenter />);

    const receipt = raisedWithId(UP_TO_DATE_TOAST_ID);
    expect(receipt).toMatchObject({
      weight: "announcement",
      title: "You're up to date",
      description: "Proliferate 0.1.22 is the latest — checked just now.",
      duration: 4_000,
    });
    // A receipt for a question the user just asked needs no domain eyebrow.
    expect(receipt).not.toHaveProperty("badge");
    expect(updaterMocks.clearManualCheckCompleted).toHaveBeenCalledTimes(1);
  });
});

describe("UpdateToastPresenter — available", () => {
  it("offers download and skip, and names why it is asking", () => {
    render(<UpdateToastPresenter />);

    const toastInput = raisedWithId(UPDATE_TOAST_ID);
    expect(toastInput).toMatchObject({
      weight: "announcement",
      badge: "UPDATE",
      title: "Introducing Grok",
      description:
        "Proliferate 0.1.24 is ready to download. Automatic updates are off.",
    });
  });

  it("falls back to generic copy when the manifest has no title", () => {
    updaterMocks.availableTitle = null;

    render(<UpdateToastPresenter />);

    expect(raisedWithId(UPDATE_TOAST_ID)).toMatchObject({
      title: "Update available",
    });
  });

  it("routes Skip this version to the store so it is never re-announced", () => {
    render(<UpdateToastPresenter />);

    const toastInput = raisedWithId(UPDATE_TOAST_ID) as {
      secondary: { label: string; onClick: () => void };
      commit: { label: string; onClick: () => void };
    };
    expect(toastInput.secondary.label).toBe("Skip this version");
    toastInput.secondary.onClick();
    expect(updaterMocks.skipVersion).toHaveBeenCalledTimes(1);

    toastInput.commit.onClick();
    expect(updaterMocks.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("supersedes the up-to-date receipt when an update enters the flow", () => {
    render(<UpdateToastPresenter />);

    expect(toastMocks.dismissToast).toHaveBeenCalledWith(UP_TO_DATE_TOAST_ID);
  });
});

describe("UpdateToastPresenter — stalled", () => {
  it("names the stall, its silence, and offers a retry", () => {
    updaterMocks.phase = "stalled";
    updaterMocks.downloadProgress = 38;
    updaterMocks.lastProgressAt = Date.now() - 12_000;
    updaterMocks.downloadRetryCount = 1;

    render(<UpdateToastPresenter />);

    const toastInput = raisedWithId(UPDATE_TOAST_ID) as {
      tone: string;
      title: string;
      description: string;
      commit: { label: string; onClick: () => void };
    };
    expect(toastInput.tone).toBe("warning");
    expect(toastInput.title).toBe("Download stalled at 38%");
    expect(toastInput.description).toContain("retried once");
    expect(toastInput.commit.label).toBe("Retry now");

    toastInput.commit.onClick();
    expect(updaterMocks.retryDownload).toHaveBeenCalledTimes(1);
  });
});

describe("UpdateToastPresenter — ready", () => {
  it("restarts directly when nothing is running", () => {
    updaterMocks.phase = "ready";

    render(<UpdateToastPresenter />);

    const toastInput = raisedWithId(UPDATE_TOAST_ID) as {
      tone: string;
      description: string;
      commit: { label: string; onClick: () => void };
    };
    expect(toastInput.tone).toBe("success");
    expect(toastInput.description).toBe(
      "Restart takes about 5 seconds and reopens where you left off.",
    );

    toastInput.commit.onClick();
    expect(updaterMocks.restartNow).toHaveBeenCalledTimes(1);
    expect(updaterMocks.openRestartPrompt).not.toHaveBeenCalled();
  });

  it("earns the confirm dialog only when restarting would kill work", () => {
    updaterMocks.phase = "ready";
    runningMocks.count = 2;

    render(<UpdateToastPresenter />);

    const toastInput = raisedWithId(UPDATE_TOAST_ID) as {
      commit: { onClick: () => void };
    };
    toastInput.commit.onClick();
    expect(updaterMocks.openRestartPrompt).toHaveBeenCalledTimes(1);
    expect(updaterMocks.restartNow).not.toHaveBeenCalled();
  });

  it("hides the ready toast while the confirm dialog is open", () => {
    updaterMocks.phase = "ready";
    updaterMocks.restartPromptOpen = true;

    render(<UpdateToastPresenter />);

    expect(raisedWithId(UPDATE_TOAST_ID)).toBeUndefined();
    expect(toastMocks.dismissToast).toHaveBeenCalledWith(UPDATE_TOAST_ID);
  });
});

describe("UpdateToastPresenter — error", () => {
  it("says what did not happen when the check fails, ignoring the raw message", () => {
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "check";
    updaterMocks.errorMessage = "getaddrinfo ENOTFOUND releases.proliferate.dev";

    render(<UpdateToastPresenter />);

    expect(raisedWithId(UPDATE_TOAST_ID)).toMatchObject({
      tone: "destructive",
      isError: true,
      title: "Couldn't check for updates",
      description:
        "Check your connection and try again. You're still on the version you had.",
    });
  });

  it("keeps a short human download message", () => {
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "download";
    updaterMocks.errorMessage = "The download was interrupted.";

    render(<UpdateToastPresenter />);

    expect(raisedWithId(UPDATE_TOAST_ID)).toMatchObject({
      title: "Update failed",
      description: "The download was interrupted.",
    });
  });

  it("replaces a machine-y download message with fallback copy", () => {
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "download";
    updaterMocks.errorMessage =
      "Error: EACCES: permission denied, open '/Applications/Proliferate.app'";

    render(<UpdateToastPresenter />);

    expect(raisedWithId(UPDATE_TOAST_ID)).toMatchObject({
      description: "Something went wrong downloading the update. Try again.",
    });
  });

  it("raises one toast per message and carries Retry", () => {
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "download";
    updaterMocks.errorMessage = "network unreachable";

    render(<UpdateToastPresenter />);

    expect(toastMocks.showToast).toHaveBeenCalledTimes(1);
    const toastInput = raisedWithId(UPDATE_TOAST_ID) as {
      commit: { label: string; onClick: () => void };
    };
    expect(toastInput.commit.label).toBe("Retry");
    toastInput.commit.onClick();
    expect(updaterMocks.retryDownload).toHaveBeenCalledTimes(1);
  });
});

describe("UpdateToastPresenter — deferred restart countdown", () => {
  it("warns before relaunching and lets the user stand it down", () => {
    updaterMocks.phase = "ready";
    updaterMocks.restartCountdownStartedAt = Date.now();

    render(<UpdateToastPresenter />);

    const countdown = raisedWithId(RESTART_COUNTDOWN_TOAST_ID) as {
      tone: string;
      description: string;
      secondary: { label: string; onClick: () => void };
      commit: { onClick: () => void };
    };
    expect(countdown.tone).toBe("info");
    expect(countdown.description).toContain("restarts in 10 seconds");

    countdown.secondary.onClick();
    expect(updaterMocks.cancelRestartCountdown).toHaveBeenCalledTimes(1);
  });

  it("supersedes the ready announcement instead of stacking on it", () => {
    // Both toasts are about the same update and both offer Restart, so showing
    // them together asks the same question twice — and lets "Later" contradict a
    // relaunch that is seconds away.
    updaterMocks.phase = "ready";
    updaterMocks.restartCountdownStartedAt = Date.now();

    render(<UpdateToastPresenter />);

    expect(raisedWithId(RESTART_COUNTDOWN_TOAST_ID)).toBeDefined();
    expect(raisedWithId(UPDATE_TOAST_ID)).toBeUndefined();
    expect(toastMocks.dismissToast).toHaveBeenCalledWith(UPDATE_TOAST_ID);
  });

  it("drops the countdown toast once the countdown is not running", () => {
    updaterMocks.phase = "ready";

    render(<UpdateToastPresenter />);

    expect(toastMocks.dismissToast).toHaveBeenCalledWith(
      RESTART_COUNTDOWN_TOAST_ID,
    );
  });
});
