import { useMemo } from "react";
import type { GitBranchRef } from "@anyharness/sdk";
import {
  useDetectRepoRootSetupQuery,
  useRepoRootGitBranchesQuery,
} from "@anyharness/sdk-react";
import { Button } from "@/components/ui/Button";
import {
  EnvironmentAdvancedDisclosure,
  EnvironmentField,
  EnvironmentPanel,
  EnvironmentPanelRow,
} from "@/components/ui/EnvironmentLayout";
import { EnvironmentSearchSelect } from "@/components/ui/EnvironmentSearchSelect";
import { Input } from "@/components/ui/Input";
import { ModalShell } from "@/components/ui/ModalShell";
import { useRepoSetupModalState } from "@/hooks/workspaces/use-repo-setup-modal-state";
import { resolveAutoDetectedBranch } from "@/lib/domain/settings/branch-selection";
import { SetupCommandEditor } from "./SetupCommandEditor";

const EMPTY_BRANCHES: GitBranchRef[] = [];

interface RepoSetupModalProps {
  repoRootId: string;
  sourceRoot: string;
  repoName: string;
  onClose: () => void;
}

export function RepoSetupModal({
  repoRootId,
  sourceRoot,
  repoName,
  onClose,
}: RepoSetupModalProps) {
  const {
    defaultBranch,
    setDefaultBranch,
    setupScript,
    setSetupScript,
    runCommand,
    setRunCommand,
    save,
  } = useRepoSetupModalState(sourceRoot);

  const { data: detectionResult, isLoading: isDetecting } =
    useDetectRepoRootSetupQuery({ repoRootId });
  const { data: branchRefs = EMPTY_BRANCHES } = useRepoRootGitBranchesQuery({ repoRootId });

  const branches = useMemo(
    () => branchRefs
      .filter((b) => !b.isRemote)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [branchRefs],
  );

  const autoDetectedBranch = useMemo(
    () => resolveAutoDetectedBranch(branchRefs),
    [branchRefs],
  );

  const branchButtonLabel = defaultBranch
    ? defaultBranch
    : autoDetectedBranch
      ? `Auto-detect (${autoDetectedBranch})`
      : "Auto-detect";

  const branchOptions = useMemo(() => [
    {
      id: "__auto__",
      label: "Auto-detect",
      detail: autoDetectedBranch ? `Uses ${autoDetectedBranch}` : "Uses the runtime default",
    },
    ...branches.map((b) => ({ id: b.name, label: b.name, detail: null })),
  ], [autoDetectedBranch, branches]);

  function handleSave() {
    save();
    onClose();
  }

  function handleSkip() {
    onClose();
  }

  return (
    <ModalShell
      open
      onClose={handleSkip}
      title="Repository ready"
      description={`${repoName} is available for new worktrees. Customize defaults only if this repo needs them.`}
      sizeClassName="max-w-xl"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={handleSkip}
          >
            Skip
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleSave}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="min-w-0 pr-1">
          <div className="truncate text-sm font-medium text-foreground">{repoName}</div>
          <div className="truncate text-xs text-muted-foreground">{sourceRoot}</div>
        </div>

        <EnvironmentAdvancedDisclosure
          title="Customize defaults"
          description="Branch, run command, and setup commands for new local worktrees."
        >
          <EnvironmentPanel>
            <EnvironmentPanelRow>
              <EnvironmentField
                label="Default branch"
                description="Auto-detect keeps the branch unset and uses the runtime default."
              >
                <EnvironmentSearchSelect
                  label={branchButtonLabel}
                  searchPlaceholder="Search branches"
                  emptyLabel="No branches found"
                  className="w-full"
                  menuClassName="w-80"
                  options={branchOptions.map((option) => ({
                    id: option.id,
                    label: option.label,
                    detail: option.detail,
                    selected: option.id === "__auto__"
                      ? defaultBranch === null
                      : defaultBranch === option.id,
                    onSelect: () => setDefaultBranch(option.id === "__auto__" ? null : option.id),
                  }))}
                />
              </EnvironmentField>
            </EnvironmentPanelRow>

            <EnvironmentPanelRow>
              <EnvironmentField
                label="Local action command"
                description="Command launched by the workspace header Run button for this repo."
              >
                <Input
                  value={runCommand}
                  onChange={(event) => setRunCommand(event.target.value)}
                  placeholder="make dev PROFILE=my-profile"
                  className="font-mono text-sm leading-[var(--readable-code-line-height)]"
                />
              </EnvironmentField>
            </EnvironmentPanelRow>

            <EnvironmentPanelRow>
              <EnvironmentField
                label="Setup script"
                description="Commands to run after creating a new worktree."
              >
                <SetupCommandEditor
                  hints={detectionResult?.hints ?? []}
                  currentScript={setupScript}
                  onChange={setSetupScript}
                  isLoading={isDetecting}
                />
                <p className="mt-2 text-xs text-muted-foreground/80">
                  Available vars: <code>PROLIFERATE_WORKTREE_DIR</code>,{" "}
                  <code>PROLIFERATE_REPO_DIR</code>, <code>PROLIFERATE_BRANCH</code>,{" "}
                  <code>PROLIFERATE_BASE_REF</code>.
                </p>
              </EnvironmentField>
            </EnvironmentPanelRow>
          </EnvironmentPanel>
        </EnvironmentAdvancedDisclosure>
      </div>
    </ModalShell>
  );
}
