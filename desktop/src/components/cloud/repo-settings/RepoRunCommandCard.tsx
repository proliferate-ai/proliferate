import type { ChangeEvent } from "react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsEditorRow } from "@/components/settings/SettingsEditorRow";
import { RunCommandHelp } from "@/components/settings/RunCommandHelp";
import { Input } from "@/components/ui/Input";

interface RepoRunCommandCardProps {
  runCommand: string;
  onChange: (value: string) => void;
}

export function RepoRunCommandCard({
  runCommand,
  onChange,
}: RepoRunCommandCardProps) {
  return (
    <SettingsCard>
      <SettingsEditorRow
        label="Cloud run command"
        description="Command launched by the workspace header Run button for cloud workspaces in this environment."
      >
        <div className="space-y-2">
          <Input
            value={runCommand}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
            placeholder="make dev PROFILE=my-profile"
            className="font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)]"
          />
          <RunCommandHelp scope="selected cloud workspace" />
        </div>
      </SettingsEditorRow>
    </SettingsCard>
  );
}
