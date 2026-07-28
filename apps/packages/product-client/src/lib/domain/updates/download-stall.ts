/**
 * Stall detection for the update download.
 *
 * A dead connection and a slow one are indistinguishable without this: the
 * progress bar simply stops, and `totalBytes === null` means there is no bar to
 * stop. Both collapse into one named phase here, so the UI can say "stalled at
 * 38%, no data for 12 seconds, retried twice" instead of sitting on "Starting
 * download…" indefinitely.
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

/**
 * True when the download has gone quiet long enough to name it.
 *
 * One clock covers both failure shapes. A server that advertises no total gives
 * no progress bar, so silence is the only signal available there; a server that
 * does advertise one still goes quiet the same way when the connection drops.
 * Measuring only the silence is what lets both cases share one phase and one
 * piece of copy.
 */
export function isDownloadStalled({
  lastProgressAt,
  now,
}: DownloadStallInput): boolean {
  // Nothing has been observed yet — the download hasn't reported in at all, so
  // there is no interval to judge.
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
