export function assertStillCurrent(shouldContinue: () => boolean): void {
  if (!shouldContinue()) {
    throw new Error("Queued prompt handoff was cancelled.");
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function nextPollDelay(currentMs: number): number {
  return Math.min(Math.round(currentMs * 1.5), 2_500);
}
