import { useState } from "react";
import { Badge, Button, SettingsRow, Select, Switch } from "@proliferate/ui";

const noop = () => {};

function RowSwitch({ initial }: { initial: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <Switch checked={checked} onChange={setChecked} />;
}

export const WithControls = () => (
  <div className="w-[36rem] rounded-lg border border-border px-4">
    <SettingsRow
      label="Auto-approve read-only tools"
      description="Let the agent run file reads and searches without asking each time."
    >
      <RowSwitch initial />
    </SettingsRow>
    <SettingsRow
      label="Default model"
      description="Used for every new session in this workspace."
    >
      <div className="w-60">
        <Select defaultValue="opus" onChange={noop}>
          <option value="opus">Claude Opus 4.6</option>
          <option value="sonnet">Claude Sonnet 4.6</option>
          <option value="haiku">Claude Haiku 4.5</option>
        </Select>
      </div>
    </SettingsRow>
    <SettingsRow
      label="GitHub App"
      description="proliferate-dev is installed on 4 repositories."
    >
      <Button size="sm" variant="secondary">Manage</Button>
    </SettingsRow>
  </div>
);

export const WithoutDescription = () => (
  <div className="w-[36rem] rounded-lg border border-border px-4">
    <SettingsRow label="Stream reasoning tokens">
      <RowSwitch initial />
    </SettingsRow>
    <SettingsRow label="Play a sound when a run finishes">
      <RowSwitch initial={false} />
    </SettingsRow>
    <SettingsRow label="Collapse tool output by default">
      <RowSwitch initial />
    </SettingsRow>
  </div>
);

export const WithStatusControl = () => (
  <div className="w-[36rem] rounded-lg border border-border px-4">
    <SettingsRow
      label="Sandbox network access"
      description="Outbound HTTPS is proxied through the agent proxy. Blocking it breaks package installs."
    >
      <Badge tone="neutral">Restricted</Badge>
      <Button size="sm" variant="ghost">Edit</Button>
    </SettingsRow>
    <SettingsRow
      label="Container image"
      description="ghcr.io/proliferate/agent-runtime:2026.07.3"
    >
      <Badge tone="success">Up to date</Badge>
    </SettingsRow>
  </div>
);
