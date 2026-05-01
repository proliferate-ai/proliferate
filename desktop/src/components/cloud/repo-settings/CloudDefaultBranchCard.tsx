import { EnvironmentField } from "@/components/ui/EnvironmentLayout";
import { EnvironmentSearchSelect } from "@/components/ui/EnvironmentSearchSelect";

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
  const options = [
    {
      id: "__github__",
      label: githubDefaultBranch
        ? `GitHub default (${githubDefaultBranch})`
        : "GitHub default",
      detail: githubDefaultBranch ? `Follows ${githubDefaultBranch}` : "Follows the repo's current default branch",
      selected: value === null,
      onSelect: () => onChange(null),
    },
    ...(hasStaleSavedBranch && value ? [{
      id: value,
      label: value,
      detail: "Saved branch missing on GitHub",
      selected: true,
      onSelect: () => onChange(value),
    }] : []),
    ...branches.map((branch) => ({
      id: branch,
      label: branch,
      detail: null,
      selected: value === branch,
      onSelect: () => onChange(branch),
    })),
  ];
  const buttonLabel = value ?? (githubDefaultBranch ? `GitHub default (${githubDefaultBranch})` : "GitHub default");

  return (
    <EnvironmentField
      label="Default branch"
      description="Base branch for new cloud workspaces when create runs without an explicit branch override."
    >
      <div className="space-y-2">
        <EnvironmentSearchSelect
          label={buttonLabel}
          options={options}
          searchPlaceholder="Search branches"
          emptyLabel="No branches found"
          className="w-64"
          menuClassName="w-80"
          disabled={isLoading}
        />

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
    </EnvironmentField>
  );
}
