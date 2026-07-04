import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import type { OrgSandboxProfileResponse } from "@proliferate/cloud-sdk";

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoString;
  }
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    creating: "text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/30",
    ready: "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/30",
    paused: "text-muted-foreground bg-muted",
    error: "text-destructive bg-destructive/10",
    destroyed: "text-muted-foreground bg-muted line-through",
  };
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-ui-xs font-medium ${colors[status] ?? colors.creating}`}>
      {status}
    </span>
  );
}

export function OrgSandboxProfilesSection({
  profiles,
  canManage,
  creating,
  onCreateProfile,
}: {
  profiles: OrgSandboxProfileResponse[];
  canManage: boolean;
  creating: boolean;
  onCreateProfile: (displayName: string) => void;
}) {
  const [newName, setNewName] = useState("");

  function handleCreate() {
    const trimmed = newName.trim();
    if (trimmed) {
      onCreateProfile(trimmed);
      setNewName("");
    }
  }

  return (
    <SettingsSection
      title="Org sandboxes"
      description="Shared cloud sandboxes available to all organization members"
    >
      <div className="space-y-4">
        {profiles.length > 0 ? (
          <div className="divide-y divide-border rounded-md border">
            {profiles.map((profile) => (
              <div key={profile.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-ui-sm font-medium">
                    {profile.displayName ?? "Untitled"}
                  </span>
                  <span className="text-ui-xs text-muted-foreground">
                    Created {formatDate(profile.createdAt)}
                  </span>
                </div>
                {statusBadge(profile.status)}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-ui-sm text-muted-foreground">
            No shared sandboxes yet.
          </p>
        )}

        {canManage ? (
          <SettingsRow label="Create sandbox" description="Add a new shared sandbox for the team">
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setNewName(event.currentTarget.value)}
                placeholder="Sandbox name"
                aria-label="New sandbox name"
                className="w-48"
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleCreate();
                  }
                }}
              />
              <Button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim()}
                loading={creating}
              >
                Create
              </Button>
            </div>
          </SettingsRow>
        ) : null}
      </div>
    </SettingsSection>
  );
}
