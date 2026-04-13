import type { SupportMessageContext } from "@/lib/integrations/cloud/client";

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
  // Leave the email body empty on purpose — the subject already identifies
  // the product, and the user should start with a clean textarea rather
  // than the default robotic "Context: / Intent: general" template.
  return "";
}
