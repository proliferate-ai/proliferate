import type { ChangeEvent } from "react";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  EnvironmentSearchSelect,
  type EnvironmentSearchSelectOption,
} from "@proliferate/ui/primitives/EnvironmentSearchSelect";
import { Input } from "@proliferate/ui/primitives/Input";
import { SettingsRow } from "../settings/SettingsRow";
import { SettingsSection } from "../settings/SettingsSection";
import { ScriptBlock } from "./ScriptBlock";

export interface CloudEnvironmentConfigSectionProps {
  statusLabel: string;
  statusTone: "neutral" | "success" | "info" | "warning" | "destructive";
  defaultBranch: string | null;
  githubDefaultBranch: string | null;
  branches: readonly string[];
  branchesLoading?: boolean;
  branchError?: string | null;
  setupScript: string;
  runCommand: string;
  saving?: boolean;
  saveDisabled?: boolean;
  revertDisabled?: boolean;
  error?: string | null;
  onDefaultBranchChange: (value: string | null) => void;
  onSetupScriptChange: (value: string) => void;
  onRunCommandChange: (value: string) => void;
  onSave: () => void;
  onRevert: () => void;
}

/**
 * The per-environment cloud configuration editor core: default branch, run
 * command, and setup script over the PUT environment endpoint. Purely
 * presentational — callers own the page header, breadcrumb, and secrets slot.
 */
export function CloudEnvironmentConfigSection({
  statusLabel,
  statusTone,
  defaultBranch,
  githubDefaultBranch,
  branches,
  branchesLoading = false,
  branchError = null,
  setupScript,
  runCommand,
  saving = false,
  saveDisabled = false,
  revertDisabled = false,
  error = null,
  onDefaultBranchChange,
  onSetupScriptChange,
  onRunCommandChange,
  onSave,
  onRevert,
}: CloudEnvironmentConfigSectionProps) {
  const hasStaleSavedBranch = Boolean(defaultBranch && !branches.includes(defaultBranch));
  const branchOptions: EnvironmentSearchSelectOption[] = [
    {
      id: "__github__",
      label: "GitHub default",
      detail: githubDefaultBranch ? `Currently ${githubDefaultBranch}` : null,
      selected: defaultBranch === null,
      onSelect: () => onDefaultBranchChange(null),
    },
    ...(hasStaleSavedBranch && defaultBranch ? [{
      id: defaultBranch,
      label: `${defaultBranch} (saved, missing on GitHub)`,
      selected: true,
      onSelect: () => onDefaultBranchChange(defaultBranch),
    }] : []),
    ...branches.map((branch) => ({
      id: branch,
      label: branch,
      selected: defaultBranch === branch,
      onSelect: () => onDefaultBranchChange(branch),
    })),
  ];

  return (
    <SettingsSection
      title="Cloud environment"
      description="Runs in Proliferate Cloud sandboxes for this repository."
    >
      <SettingsRow
        label="Default branch"
        description={branchHelperText({ branchesLoading, branchError, githubDefaultBranch })}
      >
        <EnvironmentSearchSelect
          label={defaultBranch ?? (githubDefaultBranch ? `GitHub default (${githubDefaultBranch})` : "GitHub default")}
          options={branchOptions}
          searchPlaceholder="Search branches"
          emptyLabel="No branches found"
          className="w-64"
          menuClassName="w-80"
          disabled={branchesLoading}
        />
      </SettingsRow>

      <SettingsRow
        label="Run command"
        className="sm:items-start"
        description="Launched by the workspace Run action in cloud workspaces."
      >
        <Input
          aria-label="Cloud run command"
          value={runCommand}
          placeholder="make dev"
          className="h-8 w-72 px-2.5 font-mono text-ui-sm"
          onChange={(event: ChangeEvent<HTMLInputElement>) => onRunCommandChange(event.currentTarget.value)}
        />
      </SettingsRow>

      <SettingsRow
        label="Setup script"
        description="Runs once when a cloud workspace is created."
        className="sm:flex-col sm:items-stretch"
      >
        <ScriptBlock
          ariaLabel="Cloud setup script"
          fileLabel="setup.sh"
          value={setupScript}
          placeholder={"pnpm install\npnpm prisma generate"}
          onChange={onSetupScriptChange}
          className="w-full"
        />
      </SettingsRow>

      {error ? (
        <p className="border-t border-border pt-3 text-ui-sm text-destructive">{error}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Badge tone={statusTone}>{statusLabel}</Badge>
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
    </SettingsSection>
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
