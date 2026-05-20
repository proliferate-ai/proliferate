import type { SupportMessageContext } from "@/lib/domain/support/types";

export function formatSupportContextLabel(
  context: SupportMessageContext,
): string | null {
  if (context.workspaceName && context.workspaceLocation) {
    return `${context.workspaceLocation} · ${context.workspaceName}`;
  }
  if (context.workspaceName) {
    return context.workspaceName;
  }
  return null;
}

export function buildSupportEmailBody(_context: SupportMessageContext): string {
  return "";
}
