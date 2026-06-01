import type { CloudSessionProjection } from "@proliferate/cloud-sdk";

export function mobileWorkspaceSessionDisplayTitle(
  session: CloudSessionProjection,
  index: number,
): string {
  const title = session.title?.trim();
  return title || `Session ${index + 1}`;
}

export function formatMobileWorkspaceActionSessionCount(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

export function formatMobileWorkspaceActionSessionStatus(status: string): string {
  const normalized = status.replace(/_/g, " ").trim();
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "Unknown";
}

export function isMobileWorkspaceActionSessionErrorStatus(status: string): boolean {
  return status === "failed" || status === "error";
}
