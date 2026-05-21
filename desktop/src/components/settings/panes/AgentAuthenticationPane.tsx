import type { AgentAuthAgentKind } from "@proliferate/cloud-sdk";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { CloudAgentAuthLibrary } from "@/components/settings/panes/agent-authentication/CloudAgentAuthLibrary";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";

interface AgentAuthenticationPaneProps {
  initialAgentKind?: string | null;
}

export function AgentAuthenticationPane({ initialAgentKind = null }: AgentAuthenticationPaneProps) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={agentAuthenticationCopy.pageTitle}
        description={agentAuthenticationCopy.pageDescription}
      />
      <CloudAgentAuthLibrary initialAgentKind={parseAgentKind(initialAgentKind)} />
    </section>
  );
}

function parseAgentKind(value: string | null): AgentAuthAgentKind | null {
  if (value === "claude" || value === "codex" || value === "opencode" || value === "gemini") {
    return value;
  }
  return null;
}
