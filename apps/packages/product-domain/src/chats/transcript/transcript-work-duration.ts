export function formatWorkedForDuration(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): string | null {
  if (!startedAt || !completedAt) {
    return null;
  }
  const elapsedMs = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return null;
  }

  const totalSeconds = Math.floor(elapsedMs / 1_000);
  if (totalSeconds === 0) {
    return "Worked for <1s";
  }
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    seconds > 0 || (hours === 0 && minutes === 0) ? `${seconds}s` : null,
  ].filter((part): part is string => part !== null);
  return `Worked for ${parts.join(" ")}`;
}
