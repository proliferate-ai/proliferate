export function desktopWorkerStartupFailureCopy(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const normalizedDetail = detail.trim().length > 0 ? detail.trim() : "Unknown error";
  return `Cloud integrations worker failed to start: ${normalizedDetail}`;
}
