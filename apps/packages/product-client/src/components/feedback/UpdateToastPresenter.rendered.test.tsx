// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastHost } from "@proliferate/ui/patterns/ToastHost";
import { dismissToast } from "@proliferate/ui/utils/show-toast";
import { UpdateToastPresenter } from "#product/components/feedback/UpdateToastPresenter";

/**
 * The update flow, actually rendered.
 *
 * `UpdateToastPresenter.test.tsx` mocks `show-toast` and reads the input
 * objects, which is the right test for *which* toast the presenter chooses. It
 * cannot see whether the choice survives the kit: a `cause` routed to Details
 * still prints in the body if the body renders `details.payload`, and a Retry
 * wired to the wrong action still looks correct as an input object. So this file
 * mounts the real `showToast` behind the real `ToastHost` and drives the buttons
 * a person would press.
 *
 * Only the updater hook and the host are faked — everything from `showToast`
 * down is the shipping code.
 */

const updaterMocks = vi.hoisted(() => ({
  phase: "ready" as string,
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
  checkNow: vi.fn(),
  clearManualCheckCompleted: vi.fn(),
}));

const openExternal = vi.hoisted(() => vi.fn());

vi.mock("#product/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => updaterMocks,
}));

vi.mock("#product/hooks/access/tauri/app/use-app-version", () => ({
  useAppVersion: () => ({ data: "0.1.22" }),
}));

vi.mock("#product/hooks/app/lifecycle/use-running-agent-count", () => ({
  useRunningAgentCount: () => 0,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ links: { openExternal } }),
}));

/**
 * jsdom implements no Pointer Capture API, and sonner's swipe-to-dismiss calls
 * `setPointerCapture` on every pointerdown. React swallows the resulting
 * TypeError, so the clicks below still land and the assertions still hold — but
 * it printed a stack trace per click, which is exactly the kind of noise that
 * trains people to stop reading test output. Stubbed rather than silenced: a
 * no-op capture is what a real element does for a gesture nobody performs.
 */
beforeAll(() => {
  for (const method of ["setPointerCapture", "releasePointerCapture", "hasPointerCapture"] as const) {
    if (!(method in Element.prototype)) {
      Object.defineProperty(Element.prototype, method, {
        configurable: true,
        value: () => (method === "hasPointerCapture" ? false : undefined),
      });
    }
  }
});

/**
 * `ToastHost` first, deliberately: sonner's `Toaster` subscribes to the toast
 * store in an effect, and sibling effects fire in tree order — a toast published
 * by the presenter before that subscription exists is dropped on the floor. In
 * the app the host is mounted in the shell long before any flow speaks, so this
 * ordering is the faithful one, not a workaround.
 */
function renderFlow() {
  return render(
    <>
      <ToastHost />
      <UpdateToastPresenter />
    </>,
  );
}

afterEach(() => {
  // sonner's toast store lives outside React on purpose — `showToast` is a plain
  // function callable from anywhere — so it outlives the unmount. A toast still
  // queued when the next test mounts its host leaves a stale frame over the new
  // one, and `user-event` refuses to click through it (`pointer-events: none`).
  dismissToast();
  cleanup();
  vi.clearAllMocks();
  updaterMocks.phase = "ready";
  updaterMocks.availableTitle = "Introducing Grok";
  updaterMocks.errorMessage = null;
  updaterMocks.errorSource = null;
  updaterMocks.downloadProgress = null;
  updaterMocks.lastProgressAt = null;
  updaterMocks.downloadRetryCount = 0;
  updaterMocks.restartPromptOpen = false;
  updaterMocks.restartCountdownStartedAt = null;
  updaterMocks.manualCheckCompletedAt = null;
});

describe("the update flow, rendered", () => {
  it("shows the ready announcement with one solid commit", async () => {
    renderFlow();

    expect(await screen.findByText("Introducing Grok")).toBeTruthy();
    expect(
      screen.getByText(
        "Restart takes about 5 seconds and reopens where you left off.",
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(updaterMocks.restartNow).toHaveBeenCalledTimes(1);
  });

  it("keeps the updater's raw string out of the body and behind Details", async () => {
    const cause = "Error: EACCES: permission denied, open '/Applications/Proliferate.app'";
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "download";
    updaterMocks.errorMessage = cause;

    renderFlow();

    expect(await screen.findByText("Update failed")).toBeTruthy();
    // The rule the fields split exists to enforce, checked against the DOM
    // rather than the input object: no node anywhere in the toast carries it.
    expect(screen.queryByText(cause)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    // The details modal is lazy, so it arrives a tick later.
    expect(await screen.findByText(cause)).toBeTruthy();

    // Close it here rather than in `afterEach`: the details store is module-level
    // and not an exported entrypoint of the kit, so the only honest way to reset
    // it is the way a person does — Escape.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("Copy details")).toBeNull();
    });
  });

  it("wires the failed check's Retry to the check, not the download", async () => {
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "check";
    updaterMocks.errorMessage = "getaddrinfo ENOTFOUND releases.proliferate.dev";

    renderFlow();

    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(updaterMocks.checkNow).toHaveBeenCalledTimes(1);
    expect(updaterMocks.retryDownload).not.toHaveBeenCalled();
  });

  it("wires the failed download's Retry to the download", async () => {
    updaterMocks.phase = "error";
    updaterMocks.errorSource = "download";
    updaterMocks.errorMessage = "network unreachable";

    renderFlow();

    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(updaterMocks.retryDownload).toHaveBeenCalledTimes(1);
    expect(updaterMocks.checkNow).not.toHaveBeenCalled();
  });

  it("renders the counted countdown and lets the user stand it down", async () => {
    updaterMocks.restartCountdownStartedAt = Date.now() - 6_400;

    renderFlow();

    expect(
      await screen.findByText(
        "Your sessions finished, so Proliferate restarts in 4 seconds.",
      ),
    ).toBeTruthy();
    // Supersedes rather than stacks: the ready announcement asks the same
    // question and its "Later" would contradict a relaunch seconds away.
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(updaterMocks.cancelRestartCountdown).toHaveBeenCalledTimes(1);
  });

  it("names the stall and its silence, then retries the download", async () => {
    updaterMocks.phase = "stalled";
    updaterMocks.downloadProgress = 38;
    updaterMocks.lastProgressAt = Date.now() - 12_000;
    updaterMocks.downloadRetryCount = 1;

    renderFlow();

    expect(await screen.findByText("Download stalled at 38%")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(updaterMocks.retryDownload).toHaveBeenCalledTimes(1);
  });

  it("goes quiet when the phase leaves the flow", async () => {
    updaterMocks.phase = "downloading";

    renderFlow();

    await waitFor(() => {
      expect(screen.queryByText("Introducing Grok")).toBeNull();
    });
  });
});
