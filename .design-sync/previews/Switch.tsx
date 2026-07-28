import { useState } from "react";
import { Label, SettingsRow, Switch } from "@proliferate/ui";

function StatefulSwitch({
  initial,
  size,
}: {
  initial: boolean;
  size?: "default" | "compact";
}) {
  const [checked, setChecked] = useState(initial);
  return <Switch checked={checked} onChange={setChecked} size={size} />;
}

export const Sizes = () => (
  <div className="flex items-center gap-8">
    <div className="flex flex-col items-start gap-2">
      <StatefulSwitch initial size="default" />
      <span className="text-ui-sm text-muted-foreground">default</span>
    </div>
    <div className="flex flex-col items-start gap-2">
      <StatefulSwitch initial size="compact" />
      <span className="text-ui-sm text-muted-foreground">compact</span>
    </div>
  </div>
);

export const States = () => (
  <div className="flex items-center gap-8">
    <div className="flex flex-col items-start gap-2">
      <StatefulSwitch initial />
      <span className="text-ui-sm text-muted-foreground">on</span>
    </div>
    <div className="flex flex-col items-start gap-2">
      <StatefulSwitch initial={false} />
      <span className="text-ui-sm text-muted-foreground">off</span>
    </div>
    <div className="flex flex-col items-start gap-2">
      <Switch checked onChange={() => {}} disabled />
      <span className="text-ui-sm text-muted-foreground">on, disabled</span>
    </div>
    <div className="flex flex-col items-start gap-2">
      <Switch checked={false} onChange={() => {}} disabled />
      <span className="text-ui-sm text-muted-foreground">off, disabled</span>
    </div>
  </div>
);

export const WithLabel = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-3">
      <Switch id="stream-reasoning" checked onChange={() => {}} />
      <Label htmlFor="stream-reasoning">Stream reasoning tokens</Label>
    </div>
    <div className="flex items-center gap-3">
      <Switch id="sound-on-finish" checked={false} onChange={() => {}} />
      <Label htmlFor="sound-on-finish">Play a sound when a run finishes</Label>
    </div>
  </div>
);

export const InSettingsRows = () => (
  <div className="w-[32rem] rounded-lg border border-border px-4">
    <SettingsRow
      label="Auto-approve read-only tools"
      description="File reads and searches run without asking each time."
    >
      <StatefulSwitch initial />
    </SettingsRow>
    <SettingsRow
      label="Allow network access in the sandbox"
      description="Outbound HTTPS is proxied through the agent proxy."
    >
      <StatefulSwitch initial={false} />
    </SettingsRow>
    <SettingsRow label="Collapse tool output by default">
      <StatefulSwitch initial size="compact" />
    </SettingsRow>
  </div>
);
