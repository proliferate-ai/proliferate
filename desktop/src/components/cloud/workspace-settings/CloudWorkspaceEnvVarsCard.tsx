import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { Badge } from "@/components/ui/Badge";

interface CloudWorkspaceEnvVarsCardProps {
  envVarKeys: string[];
}

export function CloudWorkspaceEnvVarsCard({
  envVarKeys,
}: CloudWorkspaceEnvVarsCardProps) {
  return (
    <SettingsCard className="divide-y-0 bg-sidebar/60">
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Repo env vars</p>
          <Badge>{envVarKeys.length}</Badge>
        </div>
        {envVarKeys.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {envVarKeys.map((key) => (
              <Badge key={key}>{key}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No repo env vars are saved. Env vars only apply to newly created cloud workspaces in v1.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}
