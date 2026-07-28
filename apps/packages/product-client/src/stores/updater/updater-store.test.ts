import { beforeEach, describe, expect, it } from "vitest";
import { useUpdaterStore } from "#product/stores/updater/updater-store";

const update = (version: string, title: string | null = null) => ({
  version,
  title,
  handle: {},
});

describe("updater store", () => {
  beforeEach(() => {
    useUpdaterStore.getState().reset();
  });

  it("records which step produced the error", () => {
    useUpdaterStore.getState().setError("release feed unreachable", "check");

    expect(useUpdaterStore.getState().phase).toBe("error");
    expect(useUpdaterStore.getState().errorMessage).toBe("release feed unreachable");
    expect(useUpdaterStore.getState().errorSource).toBe("check");

    useUpdaterStore.getState().setError("disk full", "download");

    expect(useUpdaterStore.getState().errorSource).toBe("download");
  });

  it("clears the error source when leaving the error phase", () => {
    useUpdaterStore.getState().setError("release feed unreachable", "check");
    useUpdaterStore.getState().setPhase("checking");

    expect(useUpdaterStore.getState().errorMessage).toBeNull();
    expect(useUpdaterStore.getState().errorSource).toBeNull();

    useUpdaterStore.getState().setError("disk full", "download");
    useUpdaterStore.getState().setAvailable(update("0.2.0"));

    expect(useUpdaterStore.getState().errorMessage).toBeNull();
    expect(useUpdaterStore.getState().errorSource).toBeNull();
  });

  it("tracks the one-shot manual check completion signal", () => {
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBeNull();

    useUpdaterStore.getState().setManualCheckCompleted(1_234);
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBe(1_234);

    useUpdaterStore.getState().clearManualCheckCompleted();
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBeNull();
  });

  it("retains byte progress and only derives a percentage from a known total", () => {
    useUpdaterStore.getState().setDownloadProgress({
      receivedBytes: 12_500_000,
      totalBytes: null,
    });

    expect(useUpdaterStore.getState()).toMatchObject({
      downloadProgress: null,
      downloadReceivedBytes: 12_500_000,
      downloadTotalBytes: null,
    });

    useUpdaterStore.getState().setDownloadProgress({
      receivedBytes: 25_000_000,
      totalBytes: 100_000_000,
    });

    expect(useUpdaterStore.getState()).toMatchObject({
      downloadProgress: 25,
      downloadReceivedBytes: 25_000_000,
      downloadTotalBytes: 100_000_000,
    });
  });

  it("keeps the authored title with its available version", () => {
    useUpdaterStore.getState().setAvailable(
      update("0.3.25", "Introducing Grok"),
      "Introducing Grok",
    );

    expect(useUpdaterStore.getState().availableVersion).toBe("0.3.25");
    expect(useUpdaterStore.getState().availableTitle).toBe("Introducing Grok");

    useUpdaterStore.getState().reset();
    expect(useUpdaterStore.getState().availableTitle).toBeNull();
  });

  it("arms and disarms restart-when-idle", () => {
    useUpdaterStore.getState().setRestartWhenIdle(true);
    expect(useUpdaterStore.getState().restartWhenIdle).toBe(true);

    // A newly available update belongs to a fresh flow — the old arm no longer applies.
    useUpdaterStore.getState().setAvailable(update("0.2.0"));
    expect(useUpdaterStore.getState().restartWhenIdle).toBe(false);
  });

  it("anchors the rate on the first byte and the stall clock on the latest", () => {
    useUpdaterStore.getState().setDownloadProgress(
      { receivedBytes: 1_000, totalBytes: 100_000 },
      1_000,
    );
    expect(useUpdaterStore.getState().downloadStartedAt).toBe(1_000);
    expect(useUpdaterStore.getState().lastProgressAt).toBe(1_000);

    useUpdaterStore.getState().setDownloadProgress(
      { receivedBytes: 2_000, totalBytes: 100_000 },
      5_000,
    );
    // The start never moves — it is what the average rate is measured from.
    expect(useUpdaterStore.getState().downloadStartedAt).toBe(1_000);
    expect(useUpdaterStore.getState().lastProgressAt).toBe(5_000);

    // A repeated byte count is not progress, so the stall clock must not re-arm.
    useUpdaterStore.getState().setDownloadProgress(
      { receivedBytes: 2_000, totalBytes: 100_000 },
      9_000,
    );
    expect(useUpdaterStore.getState().lastProgressAt).toBe(5_000);
  });

  it("recovers from stalled on the next byte, because a stall is not terminal", () => {
    useUpdaterStore.getState().setDownloadProgress(
      { receivedBytes: 1_000, totalBytes: 100_000 },
      1_000,
    );
    useUpdaterStore.getState().setStalled();
    expect(useUpdaterStore.getState().phase).toBe("stalled");
    // Progress figures survive the transition, so "stalled at 38%" is sayable.
    expect(useUpdaterStore.getState().downloadProgress).toBe(1);

    useUpdaterStore.getState().setDownloadProgress(
      { receivedBytes: 2_000, totalBytes: 100_000 },
      20_000,
    );
    expect(useUpdaterStore.getState().phase).toBe("downloading");
  });

  it("counts retries and re-arms the stall clock on each one", () => {
    useUpdaterStore.getState().setStalled();
    useUpdaterStore.getState().retryDownload();

    expect(useUpdaterStore.getState().phase).toBe("downloading");
    expect(useUpdaterStore.getState().downloadRetryCount).toBe(1);
    expect(useUpdaterStore.getState().lastProgressAt).not.toBeNull();

    useUpdaterStore.getState().retryDownload();
    expect(useUpdaterStore.getState().downloadRetryCount).toBe(2);
  });

  it("records who asked for the check", () => {
    useUpdaterStore.getState().setCheckOrigin("background");
    expect(useUpdaterStore.getState().checkOrigin).toBe("background");

    useUpdaterStore.getState().setCheckOrigin("manual");
    expect(useUpdaterStore.getState().checkOrigin).toBe("manual");
  });

  it("remembers a skipped version and leaves the flow", () => {
    useUpdaterStore.getState().setAvailable(update("0.4.1"));
    useUpdaterStore.getState().skipVersion("0.4.1");

    expect(useUpdaterStore.getState().phase).toBe("idle");
    expect(useUpdaterStore.getState().skippedVersions).toEqual(["0.4.1"]);

    // Skipping twice must not grow the list — it is a set of decisions.
    useUpdaterStore.getState().skipVersion("0.4.1");
    expect(useUpdaterStore.getState().skippedVersions).toEqual(["0.4.1"]);
  });

  it("cancelling the countdown also disarms the deferred restart", () => {
    useUpdaterStore.getState().setRestartWhenIdle(true);
    useUpdaterStore.getState().startRestartCountdown(1_000);
    expect(useUpdaterStore.getState().restartCountdownStartedAt).toBe(1_000);

    useUpdaterStore.getState().cancelRestartCountdown();

    // Leaving the arm set would relaunch on the very next idle beat, which is
    // the opposite of what "Not now" meant.
    expect(useUpdaterStore.getState().restartCountdownStartedAt).toBeNull();
    expect(useUpdaterStore.getState().restartWhenIdle).toBe(false);
  });

  it("disarming stands down a countdown already in flight", () => {
    useUpdaterStore.getState().setRestartWhenIdle(true);
    useUpdaterStore.getState().startRestartCountdown(1_000);

    useUpdaterStore.getState().setRestartWhenIdle(false);

    expect(useUpdaterStore.getState().restartCountdownStartedAt).toBeNull();
  });

  it("reset clears error source, manual check signal, and armed restart", () => {
    useUpdaterStore.getState().setError("disk full", "download");
    useUpdaterStore.getState().setManualCheckCompleted(1_234);
    useUpdaterStore.getState().setRestartWhenIdle(true);

    useUpdaterStore.getState().reset();

    expect(useUpdaterStore.getState().errorSource).toBeNull();
    expect(useUpdaterStore.getState().manualCheckCompletedAt).toBeNull();
    expect(useUpdaterStore.getState().restartWhenIdle).toBe(false);
  });
});
