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
 * `formatMegabytes` rounds to one decimal, so a value under 50KB reads as a
 * bare "0" — a progress line claiming zero while bytes are actively moving
 * (D-R8). Below that floor, this shows "<0.1" instead of a number that reads
 * as stalled. Scoped to `formatDownloadedMegabytesLine` only —
 * `formatMegabytes`/`formatByteProgress` have their own established callers
 * and are left as they were.
 */
function formatSubMegabyteSafe(bytes: number): string {
  const megabytes = bytes / 1_000_000;
  if (bytes > 0 && megabytes < 0.1) {
    return "<0.1";
  }
  return formatMegabytes(bytes).replace(/ MB$/, "");
}

/**
 * The install-progress toast's downloading-phase line: "«downloaded» of
 * «total» MB downloaded", or "«downloaded» MB downloaded" when the total is
 * unknown. Unlike `formatByteProgress`, the unit is stated once at the end of
 * the sentence rather than after each number — the shape the design artifact
 * (Toast - Install Progress Set) specifies verbatim.
 *
 * `downloaded` is clamped to `total` when a total is known (D-R8): a
 * corrected-mid-transfer advertised size must never let the line claim more
 * was downloaded than the total says exists.
 */
export function formatDownloadedMegabytesLine(
  downloadedBytes: number,
  totalBytes: number | null,
): string {
  if (totalBytes !== null && totalBytes > 0) {
    // Clamp downloaded to total (never claim more downloaded than exists),
    // and use the sub-MB-safe label on both numbers (never claim "0" while
    // bytes are moving). Both fixes are scoped to the known-total form only.
    const downloaded = Math.min(Math.max(0, downloadedBytes), totalBytes);
    return `${formatSubMegabyteSafe(downloaded)} of ${formatSubMegabyteSafe(totalBytes)} MB downloaded`;
  }
  // Unknown-total form is unchanged (D-R8 scoped this fix to the known-total
  // form only).
  const downloaded = formatMegabytes(downloadedBytes).replace(/ MB$/, "");
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
