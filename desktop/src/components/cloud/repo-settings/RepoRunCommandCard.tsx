import type { ChangeEvent } from "react";
import { EnvironmentField } from "@/components/ui/EnvironmentLayout";
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
    <EnvironmentField
      label="Cloud action command"
      description="Command launched by the workspace header Run button for cloud workspaces in this environment."
    >
      <div className="space-y-2">
        <Input
          value={runCommand}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          placeholder="make dev PROFILE=my-profile"
          className="h-8 max-w-xl px-2.5 py-1.5 font-mono text-sm leading-[var(--readable-code-line-height)]"
        />
        <RunCommandHelp scope="selected cloud workspace" />
      </div>
    </EnvironmentField>
  );
}
