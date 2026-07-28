import { useState } from "react";
import { Badge, Button, SettingsRow, SettingsSection, Select, Switch } from "@proliferate/ui";

const noop = () => {};

function RowSwitch({ initial }: { initial: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <Switch checked={checked} onChange={setChecked} />;
}

export const WithRows = () => (
  <div className="w-[36rem]">
    <SettingsSection
      title="Agent defaults"
      description="Applied to every new session started in this workspace."
    >
      <SettingsRow
        label="Default model"
        description="Sessions can still switch models mid-run."
      >
        <div className="w-60">
          <Select defaultValue="opus" onChange={noop}>
            <option value="opus">Claude Opus 4.6</option>
            <option value="sonnet">Claude Sonnet 4.6</option>
          </Select>
        </div>
      </SettingsRow>
      <SettingsRow
        label="Auto-approve read-only tools"
        description="File reads and searches run without a prompt."
      >
        <RowSwitch initial />
      </SettingsRow>
      <SettingsRow label="Stream reasoning tokens">
        <RowSwitch initial={false} />
      </SettingsRow>
    </SettingsSection>
  </div>
);

export const WithAction = () => (
  <div className="w-[36rem]">
    <SettingsSection
      title="Environment secrets"
      description="Injected into every run on the proliferate/cloud repo."
      action={<Button size="sm" variant="secondary">Add secret</Button>}
    >
      <SettingsRow label="ANTHROPIC_API_KEY" description="Updated 3 days ago · 108 bytes">
        <Badge tone="success">In use</Badge>
      </SettingsRow>
      <SettingsRow label="GITHUB_TOKEN" description="Updated 2 weeks ago · 40 bytes">
        <Badge tone="neutral">Unused</Badge>
      </SettingsRow>
    </SettingsSection>
  </div>
);

export const StackedSections = () => (
  <div className="flex w-[36rem] flex-col gap-8">
    <SettingsSection title="Notifications">
      <SettingsRow label="Email me when a run needs review">
        <RowSwitch initial />
      </SettingsRow>
      <SettingsRow label="Push to mobile on failure">
        <RowSwitch initial={false} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection
      title="Danger zone"
      description="Deleting a workspace removes every session, branch, and secret it owns."
    >
      <SettingsRow label="Delete workspace" description="proliferate / design-sync">
        <Button size="sm" variant="destructive">Delete</Button>
      </SettingsRow>
    </SettingsSection>
  </div>
);

export const TitleOnly = () => (
  <div className="w-[36rem]">
    <SettingsSection title="Keyboard">
      <SettingsRow label="Command palette" description="Open the palette from anywhere.">
        <Badge tone="neutral">⌘K</Badge>
      </SettingsRow>
      <SettingsRow label="Toggle sidebar">
        <Badge tone="neutral">⌘B</Badge>
      </SettingsRow>
    </SettingsSection>
  </div>
);
