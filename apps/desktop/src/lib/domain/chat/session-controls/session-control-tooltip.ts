import type { PendingSessionConfigChangeStatus } from "@proliferate/product-domain/sessions/pending-config";

interface SessionControlTooltipInput {
  label: string;
  value?: string | null;
  description?: string | null;
  hint?: string | null;
  pendingState?: PendingSessionConfigChangeStatus | null;
}

/**
 * Builds the structured, multiline copy used by compact composer tooltips.
 * Pending feedback deliberately lives here instead of in trigger geometry so
 * optimistic config changes never shift the composer row.
 */
export function resolveSessionControlTooltip({
  label,
  value = null,
  description = null,
  hint = null,
  pendingState = null,
}: SessionControlTooltipInput): string {
  const lines = [value ? `${label}: ${value}` : label];

  if (description?.trim()) {
    lines.push(description.trim());
  }
  if (hint?.trim()) {
    lines.push(hint.trim());
  }

  const pendingCopy = resolvePendingSessionControlTooltip(pendingState);
  if (pendingCopy) {
    lines.push(pendingCopy);
  }

  return lines.join("\n");
}

export function isSessionControlUpdatePending(
  pendingState: PendingSessionConfigChangeStatus | null | undefined,
): boolean {
  return pendingState === "submitting" || pendingState === "queued";
}

function resolvePendingSessionControlTooltip(
  pendingState: PendingSessionConfigChangeStatus | null,
): string | null {
  if (pendingState === "submitting") {
    return "Saving…";
  }
  if (pendingState === "queued") {
    return "Applies after the current turn.";
  }
  return null;
}
