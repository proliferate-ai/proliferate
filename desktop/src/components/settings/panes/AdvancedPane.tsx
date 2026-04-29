import { useNavigate } from "react-router-dom";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function AdvancedPane() {
  const navigate = useNavigate();
  const powersInCodingSessionsEnabled = useUserPreferencesStore(
    (state) => state.powersInCodingSessionsEnabled,
  );
  const setPreference = useUserPreferencesStore((state) => state.set);

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Advanced"
        description="Launch policy for advanced local runtime inputs."
      />

      <SettingsCard>
        <SettingsCardRow
          label="Use Powers in coding sessions"
          description="New coding sessions receive enabled compatible Powers at launch. Existing live sessions need a restart."
        >
          <Switch
            checked={powersInCodingSessionsEnabled}
            onChange={(value) => setPreference("powersInCodingSessionsEnabled", value)}
          />
        </SettingsCardRow>
        <SettingsCardRow
          label="Powers setup"
          description="Connector setup, auth, and enablement stay on the Powers page."
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/powers")}
          >
            Open Powers
          </Button>
        </SettingsCardRow>
      </SettingsCard>
    </section>
  );
}
