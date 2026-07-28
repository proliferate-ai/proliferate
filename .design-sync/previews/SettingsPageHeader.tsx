import { Button, Plus, SettingsPageHeader } from "@proliferate/ui";

export const WithAction = () => (
  <div className="w-full max-w-3xl">
    <SettingsPageHeader
      title="Personal secrets"
      description="Secrets available in your personal cloud sandbox"
      action={
        <Button type="button" variant="secondary" size="sm">
          <Plus className="icon-paired" />
          Add secret
        </Button>
      }
    />
  </div>
);

export const TitleAndDescription = () => (
  <div className="w-full max-w-3xl">
    <SettingsPageHeader
      title="Organization"
      description="Profile, Team plan setup, and billing."
    />
  </div>
);

export const TitleOnly = () => (
  <div className="w-full max-w-3xl">
    <SettingsPageHeader title="Appearance" />
  </div>
);

export const LongDescription = () => (
  <div className="w-full max-w-3xl">
    <SettingsPageHeader
      title="Agent API keys"
      description="Keys are stored in the OS keychain on desktop and in the encrypted control-plane vault for cloud sessions. A key set here is used by every harness that does not declare its own credential."
      action={
        <Button type="button" variant="outline" size="sm">
          Rotate all
        </Button>
      }
    />
  </div>
);
