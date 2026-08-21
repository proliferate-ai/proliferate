export function formatMegabytes(bytes: number): string {
  const megabytes = Math.max(0, bytes) / 1_000_000;
  const formatted = megabytes.toFixed(1).replace(/\.0$/, "");
  return `${formatted} MB`;
}

export function formatByteProgress(
  receivedBytes: number,
  totalBytes: number | null,
): string {
  return totalBytes !== null && totalBytes > 0
    ? `${formatMegabytes(receivedBytes)} of ${formatMegabytes(totalBytes)}`
    : `${formatMegabytes(receivedBytes)} downloaded`;
}

/**
 * The install-progress toast's downloading-phase line: "«downloaded» of
 * «total» MB downloaded", or "«downloaded» MB downloaded" when the total is
 * unknown. Unlike `formatByteProgress`, the unit is stated once at the end of
 * the sentence rather than after each number — the shape the design artifact
 * (Toast - Install Progress Set) specifies verbatim.
 */
export function formatDownloadedMegabytesLine(
  downloadedBytes: number,
  totalBytes: number | null,
): string {
  const downloaded = formatMegabytes(downloadedBytes).replace(/ MB$/, "");
  if (totalBytes !== null && totalBytes > 0) {
    const total = formatMegabytes(totalBytes).replace(/ MB$/, "");
    return `${downloaded} of ${total} MB downloaded`;
  }
  return `${downloaded} MB downloaded`;
}

/**
 * Remaining download time from the average rate so far, as "10s left" /
 * "2m left".
 *
 * An average is used rather than an instantaneous rate because the estimate is
 * read on hover, one glance at a time: a rate sampled over the last event
 * jitters wildly between glances and reads as a broken number, while the
 * average only ever drifts. Returns null whenever the estimate would be a
 * guess — no advertised total, nothing downloaded yet, or no elapsed time to
 * divide by.
 */
export function formatRemainingTime(
  receivedBytes: number | null,
  totalBytes: number | null,
  startedAt: number | null,
  now: number,
): string | null {
  if (
    receivedBytes === null
    || receivedBytes <= 0
    || totalBytes === null
    || totalBytes <= 0
    || startedAt === null
  ) {
    return null;
  }
  const elapsedMs = now - startedAt;
  if (elapsedMs <= 0) {
    return null;
  }
  const remainingBytes = Math.max(0, totalBytes - receivedBytes);
  const bytesPerMs = receivedBytes / elapsedMs;
  const remainingSeconds = Math.ceil(remainingBytes / bytesPerMs / 1000);
  if (remainingSeconds < 1) {
    return "almost done";
  }
  if (remainingSeconds < 60) {
    return `${remainingSeconds}s left`;
  }
  return `${Math.ceil(remainingSeconds / 60)}m left`;
}

export function byteProgressPercent(
  receivedBytes: number,
  totalBytes: number | null,
): number | null {
  if (totalBytes === null || totalBytes <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (receivedBytes / totalBytes) * 100));
}
