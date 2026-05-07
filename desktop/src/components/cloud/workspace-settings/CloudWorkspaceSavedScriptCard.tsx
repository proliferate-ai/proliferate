import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { Badge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Textarea";

interface CloudWorkspaceSavedScriptCardProps {
  setupScript: string;
}

export function CloudWorkspaceSavedScriptCard({
  setupScript,
}: CloudWorkspaceSavedScriptCardProps) {
  return (
    <SettingsCard className="divide-y-0 bg-sidebar/60">
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Saved cloud setup script</p>
          <Badge>{setupScript.trim().length > 0 ? "Present" : "Empty"}</Badge>
        </div>
        {setupScript.trim().length > 0 ? (
          <Textarea
            readOnly
            rows={8}
            value={setupScript}
            className="min-h-36 resize-y font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)]"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No cloud setup script is saved for this repo.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}
