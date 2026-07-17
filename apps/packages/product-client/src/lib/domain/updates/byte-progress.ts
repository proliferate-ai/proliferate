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

export function byteProgressPercent(
  receivedBytes: number,
  totalBytes: number | null,
): number | null {
  if (totalBytes === null || totalBytes <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (receivedBytes / totalBytes) * 100));
}
