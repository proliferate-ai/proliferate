/**
 * Stall detection for the update download.
 *
 * A dead connection and a slow one are indistinguishable without this: the
 * progress bar simply stops. Naming that silence is what lets the UI say
 * "stalled at 38%, no data for 12 seconds, retried twice" instead of sitting on
 * "Starting download…" indefinitely.
 *
 * One clock covers every failure shape, including the "no progress bar at all"
 * one. `runDownloadAndPrepareRestart` primes the store with a zero-byte progress
 * event before awaiting the transfer, so `lastProgressAt` is armed the moment
 * the download starts — a download that never reports a single byte therefore
 * stalls on the same eight-second threshold as one that stops halfway.
 *
 * Note what is deliberately NOT a stall: bytes arriving from a server that
 * advertised no `Content-Length`. `totalBytes` is null so there is no percentage
 * to show, but the download is alive and `lastProgressAt` keeps advancing.
 * Calling that stalled would offer Retry for a problem the user does not have,
 * which is why silence rather than the missing total is what this measures.
 */

/** Bytes frozen for longer than this is a stall, not a slow link. */
export const DOWNLOAD_STALL_THRESHOLD_MS = 8_000;

export interface DownloadStallInput {
  /**
   * When the byte count last changed. The store sets it on the first progress
   * event and on every advance, so a download that produces one event and then
   * dies is caught by the same clock as one that never advances again.
   */
  lastProgressAt: number | null;
  now: number;
}

/** True when the download has gone quiet long enough to name it. */
export function isDownloadStalled({
  lastProgressAt,
  now,
}: DownloadStallInput): boolean {
  // Null only before the download is requested at all — the priming progress
  // event arms this clock — so there is no interval to judge yet.
  if (lastProgressAt === null) {
    return false;
  }
  return now - lastProgressAt >= DOWNLOAD_STALL_THRESHOLD_MS;
}

/** Whole seconds of silence, for the "no data for N seconds" clause. */
export function stalledSeconds(lastProgressAt: number | null, now: number): number {
  if (lastProgressAt === null) {
    return 0;
  }
  return Math.max(0, Math.floor((now - lastProgressAt) / 1000));
}

/**
 * "No data for 12 seconds — retried twice." The retry clause is omitted on the
 * first stall, because "retried zero times" is noise.
 */
export function formatStallDescription(
  seconds: number,
  retryCount: number,
): string {
  const silence = `No data for ${seconds} second${seconds === 1 ? "" : "s"}`;
  if (retryCount === 0) {
    return `${silence}. Your connection may have dropped.`;
  }
  const retries = retryCount === 1 ? "retried once" : `retried ${retryCount} times`;
  return `${silence} — ${retries}. Your connection may have dropped.`;
}

/** "Download stalled at 38%" — or without the percentage when there is no bar. */
export function formatStallTitle(progress: number | null): string {
  return progress === null
    ? "Download stalled"
    : `Download stalled at ${progress}%`;
}
