import type { ChangeEvent } from "react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
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
    <SettingsCard>
      <SettingsCardRow
        label="Cloud setup script"
        description="Runs after a new cloud workspace reaches ready. This script is separate from the local worktree setup script."
      >
        <div className="w-[32rem] max-w-full space-y-2">
          <Textarea
            rows={8}
            value={setupScript}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
            placeholder="pnpm install&#10;pnpm prisma generate"
            className="min-h-44 resize-y font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)]"
          />
          <p className="text-sm text-muted-foreground">
            Available vars include <code>PROLIFERATE_WORKTREE_DIR</code>, <code>PROLIFERATE_REPO_DIR</code>, <code>PROLIFERATE_BRANCH</code>, and <code>PROLIFERATE_BASE_REF</code>.
          </p>
        </div>
      </SettingsCardRow>
    </SettingsCard>
  );
}
