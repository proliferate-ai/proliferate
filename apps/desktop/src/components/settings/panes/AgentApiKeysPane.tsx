import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { AgentApiKeysSection } from "@/components/settings/panes/agent-auth/AgentApiKeysSection";

export function AgentApiKeysPane() {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="API Keys"
        description="Provider keys agents use when their authentication route is set to API key."
      />

      <AgentApiKeysSection />
    </section>
  );
}
