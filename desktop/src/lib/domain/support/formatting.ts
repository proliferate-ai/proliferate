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

export function buildSupportEmailBody(context: SupportMessageContext): string {
  const contextLabel = formatSupportContextLabel(context);
  const details = [
    contextLabel ? `Context: ${contextLabel}` : null,
    context.workspaceId ? `Workspace ID: ${context.workspaceId}` : null,
    context.pathname ? `Path: ${context.pathname}` : null,
    `Source: ${context.source}`,
    `Intent: ${context.intent}`,
  ].filter((line): line is string => Boolean(line));

  return `\n\n---\n${details.join("\n")}`;
}
