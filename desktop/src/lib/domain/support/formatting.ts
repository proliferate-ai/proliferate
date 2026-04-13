import type { SupportMessageContext } from "@/lib/integrations/cloud/client";

export function formatSupportContextLabel(context: SupportMessageContext): string {
  if (context.workspaceName && context.workspaceLocation) {
    return `${context.workspaceLocation} · ${context.workspaceName}`;
  }
  if (context.workspaceName) {
    return context.workspaceName;
  }
  if (context.pathname) {
    return context.pathname;
  }
  return "Current app context will be included.";
}

export function buildSupportEmailBody(context: SupportMessageContext): string {
  const contextLabel = formatSupportContextLabel(context);

  return `Context: ${contextLabel}\nIntent: ${context.intent}\n\nHow can you help?\n`;
}
