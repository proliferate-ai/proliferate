import { useState } from "react";
import { SettingsRow, SettingsSaveFooter, Switch } from "@proliferate/ui";

const noop = () => {};

function RowSwitch({ initial }: { initial: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <Switch checked={checked} onChange={setChecked} />;
}

export const Default = () => (
  <div className="flex w-[36rem] flex-col gap-3">
    <SettingsSaveFooter onSave={noop} onRevert={noop} />
  </div>
);

export const WithStatus = () => (
  <div className="flex w-[36rem] flex-col gap-6">
    <SettingsSaveFooter
      statusLabel="Unsaved changes"
      statusTone="accent"
      onSave={noop}
      onRevert={noop}
    />
    <SettingsSaveFooter
      statusLabel="Saved 2 minutes ago"
      statusTone="success"
      saveDisabled
      revertDisabled
      onSave={noop}
      onRevert={noop}
    />
  </div>
);

export const Saving = () => (
  <div className="flex w-[36rem] flex-col gap-3">
    <SettingsSaveFooter
      statusLabel="Applying to 4 repositories"
      statusTone="info"
      saving
      onSave={noop}
      onRevert={noop}
    />
  </div>
);

export const WithError = () => (
  <div className="flex w-[36rem] flex-col gap-3">
    <SettingsSaveFooter
      error="Could not save: ANTHROPIC_API_KEY is required when the Anthropic provider is enabled."
      statusLabel="Not saved"
      statusTone="destructive"
      onSave={noop}
      onRevert={noop}
    />
  </div>
);

export const UnderSettingsRows = () => (
  <div className="flex w-[36rem] flex-col gap-3">
    <div>
      <SettingsRow label="Auto-approve read-only tools" description="File reads and searches run without a prompt.">
        <RowSwitch initial />
      </SettingsRow>
      <SettingsRow label="Stream reasoning tokens">
        <RowSwitch initial={false} />
      </SettingsRow>
    </div>
    <SettingsSaveFooter
      statusLabel="Unsaved changes"
      statusTone="accent"
      onSave={noop}
      onRevert={noop}
    />
  </div>
);
