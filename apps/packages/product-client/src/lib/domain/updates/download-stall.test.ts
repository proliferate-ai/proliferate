import { beforeEach, describe, expect, it } from "vitest";
import { useUpdaterStore } from "#product/stores/updater/updater-store";
import {
  DOWNLOAD_STALL_THRESHOLD_MS,
  formatStallDescription,
  formatStallTitle,
  isDownloadStalled,
  stalledSeconds,
} from "#product/lib/domain/updates/download-stall";

const NOW = 1_000_000;

describe("isDownloadStalled", () => {
  beforeEach(() => {
    useUpdaterStore.getState().reset();
  });

  it("is not a stall before the download has reported anything", () => {
    expect(isDownloadStalled({ lastProgressAt: null, now: NOW })).toBe(false);
  });

  it("is not a stall while bytes are still moving", () => {
    expect(isDownloadStalled({ lastProgressAt: NOW - 3_000, now: NOW })).toBe(false);
  });

  it("is a stall once the silence reaches the threshold", () => {
    expect(
      isDownloadStalled({
        lastProgressAt: NOW - DOWNLOAD_STALL_THRESHOLD_MS,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("stalls on silence regardless of whether a total was advertised", () => {
    // The point of one clock: a server with no Content-Length gives no progress
    // bar, but the same silence still means the same thing.
    expect(isDownloadStalled({ lastProgressAt: NOW - 20_000, now: NOW })).toBe(true);
  });

  it("does not stall a live download that simply has no percentage", () => {
    // `totalBytes: null` means no progress bar, not a dead connection. Bytes are
    // still landing, so `lastProgressAt` keeps advancing and Retry would be
    // offered for a problem the user does not have.
    useUpdaterStore.getState().setDownloadProgress(
      { receivedBytes: 4_096, totalBytes: null },
      NOW,
    );
    const { lastProgressAt, downloadProgress } = useUpdaterStore.getState();
    expect(downloadProgress).toBeNull();
    expect(isDownloadStalled({ lastProgressAt, now: NOW + 1_000 })).toBe(false);
  });

  it("arms the clock from the priming event, so a download that never reports still stalls", () => {
    // The "Starting download… forever" case. `runDownloadAndPrepareRestart`
    // primes the store with a zero-byte event before awaiting the transfer; if
    // that stopped arming `lastProgressAt`, a download that produces no progress
    // event at all could never reach the phase built for it.
    useUpdaterStore.getState().setDownloadProgress(
      { receivedBytes: 0, totalBytes: null },
      NOW,
    );
    const { lastProgressAt } = useUpdaterStore.getState();
    expect(lastProgressAt).toBe(NOW);
    expect(
      isDownloadStalled({ lastProgressAt, now: NOW + DOWNLOAD_STALL_THRESHOLD_MS }),
    ).toBe(true);
  });
});

describe("stalledSeconds", () => {
  it("reports whole seconds of silence", () => {
    expect(stalledSeconds(NOW - 12_400, NOW)).toBe(12);
  });

  it("reports zero when nothing has been observed", () => {
    expect(stalledSeconds(null, NOW)).toBe(0);
  });

  it("never reports negative silence if the clock jumps back", () => {
    expect(stalledSeconds(NOW + 5_000, NOW)).toBe(0);
  });
});

describe("stall copy", () => {
  it("omits the retry clause on the first stall", () => {
    expect(formatStallDescription(9, 0)).toBe(
      "No data for 9 seconds. Your connection may have dropped.",
    );
  });

  it("counts retries once the user has retried", () => {
    expect(formatStallDescription(12, 1)).toContain("retried once");
    expect(formatStallDescription(12, 3)).toContain("retried 3 times");
  });

  it("says a percentage only when there is one to say", () => {
    expect(formatStallTitle(38)).toBe("Download stalled at 38%");
    expect(formatStallTitle(null)).toBe("Download stalled");
  });
});
