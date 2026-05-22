import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { CloudAgentAuthLibrary } from "@/components/settings/panes/agent-authentication/CloudAgentAuthLibrary";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";

export function AgentAuthenticationPane() {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={agentAuthenticationCopy.pageTitle}
        description={agentAuthenticationCopy.pageDescription}
      />
      <CloudAgentAuthLibrary />
    </section>
  );
}
