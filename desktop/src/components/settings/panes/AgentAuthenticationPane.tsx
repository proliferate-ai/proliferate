import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { CloudAgentAuthLibrary } from "@/components/settings/panes/cloud/CloudAgentAuthLibrary";

export function AgentAuthenticationPane() {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Agent Authentication"
        description="How each harness reaches its model provider. Proliferate detects credentials already on this Mac and lets you choose which to use locally and which to sync to the cloud."
      />

      <CloudAgentAuthLibrary />
    </section>
  );
}
