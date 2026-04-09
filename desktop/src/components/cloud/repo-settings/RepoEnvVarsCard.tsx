import type { ChangeEvent } from "react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import type { CloudRepoEnvVarRow } from "@/hooks/cloud/use-cloud-repo-config-draft";

interface RepoEnvVarsCardProps {
  rows: CloudRepoEnvVarRow[];
  onAddRow: () => void;
  onUpdateRow: (
    rowId: string,
    patch: Partial<Pick<CloudRepoEnvVarRow, "key" | "value">>,
  ) => void;
  onRemoveRow: (rowId: string) => void;
}

export function RepoEnvVarsCard({
  rows,
  onAddRow,
  onUpdateRow,
  onRemoveRow,
}: RepoEnvVarsCardProps) {
  return (
    <SettingsCard>
      <SettingsCardRow
        label="Repo env vars"
        description="Injected broadly into new cloud workspaces. Existing workspaces do not re-sync env vars in v1."
      >
        <div className="w-[32rem] max-w-full space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No repo env vars yet. These apply to newly created cloud workspaces.
            </p>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor={`cloud-repo-env-key-${row.id}`}>Key</Label>
                    <Input
                      id={`cloud-repo-env-key-${row.id}`}
                      value={row.key}
                      placeholder="API_BASE_URL"
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        onUpdateRow(row.id, { key: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`cloud-repo-env-value-${row.id}`}>Value</Label>
                    <Input
                      id={`cloud-repo-env-value-${row.id}`}
                      value={row.value}
                      placeholder="https://example.internal"
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        onUpdateRow(row.id, { value: event.target.value })}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onRemoveRow(row.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button type="button" variant="outline" onClick={onAddRow}>
            Add variable
          </Button>
        </div>
      </SettingsCardRow>
    </SettingsCard>
  );
}
