import type { ChangeEvent } from "react";
import { EnvironmentField } from "@/components/settings/EnvironmentSettingsLayout";
import { Textarea } from "@/components/ui/Textarea";

interface RepoSetupScriptCardProps {
  setupScript: string;
  onChange: (value: string) => void;
}

export function RepoSetupScriptCard({
  setupScript,
  onChange,
}: RepoSetupScriptCardProps) {
  return (
    <EnvironmentField
      label="Setup script"
      description="Runs after a new cloud workspace reaches ready. This script is separate from the local worktree setup script."
    >
      <div className="space-y-2">
        <Textarea
          variant="code"
          rows={6}
          value={setupScript}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
          placeholder={"pnpm install\npnpm prisma generate"}
          className="min-h-36 px-2.5 py-2 text-sm"
        />
        <p className="text-sm text-muted-foreground">
          Available vars include <code>PROLIFERATE_WORKTREE_DIR</code>, <code>PROLIFERATE_REPO_DIR</code>, <code>PROLIFERATE_BRANCH</code>, and <code>PROLIFERATE_BASE_REF</code>.
        </p>
      </div>
    </EnvironmentField>
  );
}
