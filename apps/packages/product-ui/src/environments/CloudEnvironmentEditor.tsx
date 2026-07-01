import type { ChangeEvent, ReactNode } from "react";
import { Cloud, Plus, Trash } from "lucide-react";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Select } from "@proliferate/ui/primitives/Select";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { SettingsRow } from "../settings/SettingsRow";
import { SettingsSection } from "../settings/SettingsSection";
import { SettingsPageHeader } from "../settings/SettingsPageHeader";

export interface CloudEnvironmentEnvVarRowView {
  id: string;
  key: string;
  value: string;
}

export interface CloudEnvironmentEditorProps {
  title: string;
  description: string;
  statusLabel: string;
  statusTone?: "neutral" | "success" | "info" | "warning" | "destructive";
  defaultBranch: string | null;
  githubDefaultBranch: string | null;
  branches: readonly string[];
  branchesLoading?: boolean;
  branchError?: string | null;
  setupScript: string;
  runCommand: string;
  envVarRows?: readonly CloudEnvironmentEnvVarRowView[];
  saving?: boolean;
  saveDisabled?: boolean;
  revertDisabled?: boolean;
  disableDisabled?: boolean;
  error?: string | null;
  trackedFileCount?: number;
  trackedFilesReadOnly?: boolean;
  secretsSlot?: ReactNode;
  onDefaultBranchChange: (value: string | null) => void;
  onSetupScriptChange: (value: string) => void;
  onRunCommandChange: (value: string) => void;
  onAddEnvVar?: () => void;
  onUpdateEnvVar?: (
    rowId: string,
    patch: Partial<Pick<CloudEnvironmentEnvVarRowView, "key" | "value">>,
  ) => void;
  onRemoveEnvVar?: (rowId: string) => void;
  onSave: () => void;
  onRevert: () => void;
  onDisable?: () => void;
  breadcrumb?: ReactNode;
}

export function CloudEnvironmentEditor({
  title,
  description,
  statusLabel,
  statusTone = "neutral",
  defaultBranch,
  githubDefaultBranch,
  branches,
  branchesLoading = false,
  branchError = null,
  setupScript,
  runCommand,
  envVarRows = [],
  saving = false,
  saveDisabled = false,
  revertDisabled = false,
  disableDisabled = false,
  error = null,
  trackedFileCount = 0,
  trackedFilesReadOnly = false,
  secretsSlot = null,
  onDefaultBranchChange,
  onSetupScriptChange,
  onRunCommandChange,
  onAddEnvVar,
  onUpdateEnvVar,
  onRemoveEnvVar,
  onSave,
  onRevert,
  onDisable,
  breadcrumb = null,
}: CloudEnvironmentEditorProps) {
  const hasStaleSavedBranch = Boolean(defaultBranch && !branches.includes(defaultBranch));
  const branchOptions = [
    {
      value: "__github__",
      label: githubDefaultBranch
        ? `GitHub default (${githubDefaultBranch})`
        : "GitHub default",
    },
    ...(hasStaleSavedBranch && defaultBranch ? [{
      value: defaultBranch,
      label: `${defaultBranch} (saved, missing on GitHub)`,
    }] : []),
    ...branches.map((branch) => ({ value: branch, label: branch })),
  ];

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        {breadcrumb}
        <div className="flex items-start justify-between gap-3">
          <SettingsPageHeader title={title} description={description} />
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/25 bg-destructive-subtle px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <SettingsSection>
        <SettingsRow
          label={(
            <span className="flex items-center gap-2">
              <Cloud size={14} className="text-muted-foreground" />
              Default branch
            </span>
          )}
          description={branchHelperText({
            branchesLoading,
            branchError,
            githubDefaultBranch,
          })}
        >
          <Select
            aria-label="Cloud environment default branch"
            value={defaultBranch ?? "__github__"}
            disabled={branchesLoading}
            className="w-72"
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              const next = event.currentTarget.value;
              onDefaultBranchChange(next === "__github__" ? null : next);
            }}
          >
            {branchOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </SettingsRow>

        <SettingsRow
          label="Cloud action command"
          description="Command launched by the workspace Run action for cloud workspaces in this environment."
        >
          <Input
            aria-label="Cloud action command"
            value={runCommand}
            placeholder="make dev"
            className="w-72 font-mono text-sm"
            onChange={(event: ChangeEvent<HTMLInputElement>) => onRunCommandChange(event.currentTarget.value)}
          />
        </SettingsRow>

        <SettingsRow
          label="Setup script"
          description="Runs after a new cloud workspace reaches ready."
          className="sm:items-start"
        >
          <Textarea
            aria-label="Cloud setup script"
            value={setupScript}
            placeholder={"pnpm install\npnpm prisma generate"}
            className="h-36 w-96 font-mono text-sm"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onSetupScriptChange(event.currentTarget.value)}
          />
        </SettingsRow>
      </SettingsSection>

      {secretsSlot ?? (
        <SettingsSection>
        <SettingsRow
          label="Environment variables"
          description="Injected into new cloud workspaces for this environment."
          className="sm:items-start"
        >
          <div className="w-full max-w-xl space-y-3">
            {envVarRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No environment variables yet.</p>
            ) : (
              <div className="space-y-2">
                {envVarRows.map((row) => (
                  <div key={row.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <Input
                      aria-label="Environment variable key"
                      value={row.key}
                      placeholder="API_BASE_URL"
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        onUpdateEnvVar?.(row.id, { key: event.currentTarget.value })}
                    />
                    <Input
                      aria-label="Environment variable value"
                      value={row.value}
                      placeholder="https://example.internal"
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        onUpdateEnvVar?.(row.id, { value: event.currentTarget.value })}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Remove environment variable"
                      onClick={() => onRemoveEnvVar?.(row.id)}
                    >
                      <Trash size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={onAddEnvVar}>
              <Plus size={14} />
              Add variable
            </Button>
          </div>
        </SettingsRow>

        {trackedFilesReadOnly && trackedFileCount > 0 ? (
          <SettingsRow
            label="Tracked files"
            description={`${trackedFileCount} tracked file${trackedFileCount === 1 ? "" : "s"} ${trackedFileCount === 1 ? "is" : "are"} saved for this environment. Cloud-only edits preserve them; local file sync requires a local checkout.`}
          />
        ) : null}
        </SettingsSection>
      )}

      <div className="flex justify-end gap-2">
        {onDisable ? (
          <Button
            type="button"
            variant="outline"
            disabled={disableDisabled || saving}
            onClick={onDisable}
          >
            Disable cloud environment
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          disabled={revertDisabled || saving}
          onClick={onRevert}
        >
          Revert
        </Button>
        <Button
          type="button"
          loading={saving}
          disabled={saveDisabled}
          onClick={onSave}
        >
          Save
        </Button>
      </div>
    </section>
  );
}

function branchHelperText({
  branchesLoading,
  branchError,
  githubDefaultBranch,
}: {
  branchesLoading: boolean;
  branchError: string | null;
  githubDefaultBranch: string | null;
}): string {
  if (branchError) {
    return branchError;
  }
  if (branchesLoading) {
    return "Loading GitHub branches...";
  }
  if (githubDefaultBranch) {
    return `Leaving this on GitHub default follows ${githubDefaultBranch}.`;
  }
  return "Leaving this on GitHub default follows the repo's current default branch.";
}
