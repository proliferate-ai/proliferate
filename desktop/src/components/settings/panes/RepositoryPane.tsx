import { useMemo, useState } from "react";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { useRepositorySettings } from "@/hooks/settings/use-repository-settings";
import { useDetectRepoRootSetupQuery } from "@anyharness/sdk-react";
import { Check, ChevronUpDown } from "@/components/ui/icons";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { SetupCommandEditor } from "@/components/workspace/repo-setup/SetupCommandEditor";

interface RepositoryPaneProps {
  repository: SettingsRepositoryEntry | null;
}

export function RepositoryPane({ repository }: RepositoryPaneProps) {
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const {
    branches,
    explicitDefaultBranch,
    effectiveAutoDetectedBranch,
    setupDraft,
    setSetupDraft,
    setExplicitDefaultBranch,
  } = useRepositorySettings(repository);

  const { data: detectionResult, isLoading: isDetecting } = useDetectRepoRootSetupQuery({
    repoRootId: repository?.repoRootId ?? undefined,
    enabled: !!repository,
  });

  const effectiveBranchLabel = explicitDefaultBranch
    ?? effectiveAutoDetectedBranch
    ?? "No branches found";
  const branchButtonLabel = explicitDefaultBranch
    ? explicitDefaultBranch
    : effectiveAutoDetectedBranch
      ? `Auto-detect (${effectiveAutoDetectedBranch})`
      : "Auto-detect";

  const branchOptions = useMemo(() => [
    {
      id: "__auto__",
      label: "Auto-detect",
      detail: effectiveAutoDetectedBranch ? `Currently ${effectiveAutoDetectedBranch}` : "No branches found",
    },
    ...branches.map((branch) => ({
      id: branch.name,
      label: branch.name,
      detail: null,
    })),
  ], [branches, effectiveAutoDetectedBranch]);

  if (!repository) {
    return (
      <section className="space-y-6">
        <SettingsPageHeader title="Repository" />
        <p className="text-sm text-muted-foreground">
          No local repositories are available yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={repository.name}
        description={repository.secondaryLabel ?? repository.sourceRoot}
      />

      <SettingsCard>
        <SettingsCardRow
          label="Default branch"
          description={`Base branch for new worktrees and pull requests. Effective branch: ${effectiveBranchLabel}`}
        >
        <div className="relative">
          <button
            type="button"
            onClick={() => setBranchMenuOpen((open) => !open)}
            className="flex h-8 hover:bg-accent items-center gap-1 rounded-md border border-input bg-background text-foreground pl-3 pr-2.5 py-2 w-[220px]"
          >
            <span className="truncate flex-1 text-left text-sm">{branchButtonLabel}</span>
            <ChevronUpDown className="w-3 h-3 shrink-0 text-muted-foreground" />
          </button>
          {branchMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setBranchMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-50 w-64 rounded-lg border border-border bg-popover text-popover-foreground shadow-md overflow-hidden">
                <div className="overflow-y-auto max-h-64 p-1">
                  {branchOptions.map((option) => {
                    const selected = option.id === "__auto__"
                      ? explicitDefaultBranch === null
                      : explicitDefaultBranch === option.id;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setExplicitDefaultBranch(option.id === "__auto__" ? null : option.id);
                          setBranchMenuOpen(false);
                        }}
                        className={`w-full flex items-start justify-between gap-2 px-2.5 py-2 text-left rounded-md hover:bg-muted/50 transition-colors ${
                          selected ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm">{option.label}</div>
                          {option.detail && (
                            <div className="truncate text-[11px] text-muted-foreground">{option.detail}</div>
                          )}
                        </div>
                        {selected && <Check className="size-3.5 shrink-0 text-foreground" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
        </SettingsCardRow>

        <SettingsCardRow
          label="Setup commands"
          description="Commands to run after creating a new worktree (one per line)"
        >
        <div className="w-[24rem] max-w-full">
          <SetupCommandEditor
            hints={detectionResult?.hints ?? []}
            currentScript={setupDraft}
            onChange={setSetupDraft}
            isLoading={isDetecting}
          />
          <p className="mt-2 text-sm text-muted-foreground/80">
            Runs inside the new worktree. Available vars include{" "}
            <code>PROLIFERATE_WORKTREE_DIR</code>, <code>PROLIFERATE_REPO_DIR</code>,{" "}
            <code>PROLIFERATE_BRANCH</code>, and <code>PROLIFERATE_BASE_REF</code>.
          </p>
        </div>
        </SettingsCardRow>
      </SettingsCard>
    </section>
  );
}
