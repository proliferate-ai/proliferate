import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";

const GITHUB_DEFAULT_OPTION = "__github_default__";

interface CloudDefaultBranchCardProps {
  value: string | null;
  githubDefaultBranch: string | null;
  branches: string[];
  isLoading: boolean;
  errorMessage: string | null;
  onChange: (value: string | null) => void;
}

export function CloudDefaultBranchCard({
  value,
  githubDefaultBranch,
  branches,
  isLoading,
  errorMessage,
  onChange,
}: CloudDefaultBranchCardProps) {
  const hasStaleSavedBranch = Boolean(
    value && !branches.includes(value),
  );
  const selectValue = value ?? GITHUB_DEFAULT_OPTION;

  return (
    <SettingsCard>
      <SettingsCardRow
        label="Cloud default branch"
        description="Base branch for new cloud workspaces when create runs without an explicit branch override."
      >
        <div className="w-[32rem] max-w-full space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor="cloud-default-branch">Default branch</Label>
            <Select
              id="cloud-default-branch"
              value={selectValue}
              onChange={(event) => onChange(
                event.target.value === GITHUB_DEFAULT_OPTION ? null : event.target.value,
              )}
              disabled={isLoading}
            >
              <option value={GITHUB_DEFAULT_OPTION}>
                {githubDefaultBranch
                  ? `GitHub default (${githubDefaultBranch})`
                  : "GitHub default"}
              </option>
              {hasStaleSavedBranch && value && (
                <option value={value}>
                  {`Saved branch (missing on GitHub): ${value}`}
                </option>
              )}
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </Select>
          </div>

          {errorMessage ? (
            <p className="text-sm text-destructive">{errorMessage}</p>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground">Loading GitHub branches...</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {githubDefaultBranch
                ? `Leaving this on GitHub default follows ${githubDefaultBranch}.`
                : "Leaving this on GitHub default follows the repo's current default branch."}
            </p>
          )}
        </div>
      </SettingsCardRow>
    </SettingsCard>
  );
}
