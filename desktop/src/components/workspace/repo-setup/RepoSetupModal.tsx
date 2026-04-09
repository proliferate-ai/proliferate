import { useEffect, useMemo, useRef, useState } from "react";
import type { GitBranchRef } from "@anyharness/sdk";
import { useDetectProjectSetupQuery, useGitBranchesQuery } from "@anyharness/sdk-react";
import { ModalShell } from "@/components/ui/ModalShell";
import { Check, ChevronUpDown } from "@/components/ui/icons";
import { useRepoSetupModalState } from "@/hooks/workspaces/use-repo-setup-modal-state";
import { SetupCommandEditor } from "./SetupCommandEditor";

const EMPTY_BRANCHES: GitBranchRef[] = [];

function resolveAutoDetectedBranch(branchRefs: GitBranchRef[]): string | null {
  const branches = branchRefs
    .filter((branch) => !branch.isRemote)
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    branches.find((b) => b.isDefault)
    ?? branches.find((b) => b.name === "main")
    ?? branches[0]
  )?.name ?? null;
}

interface RepoSetupModalProps {
  workspaceId: string;
  sourceRoot: string;
  repoName: string;
  onClose: () => void;
}

export function RepoSetupModal({
  workspaceId,
  sourceRoot,
  repoName,
  onClose,
}: RepoSetupModalProps) {
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const hintsInitialized = useRef(false);

  const {
    branchDraft,
    setBranchDraft,
    scriptDraft,
    setScriptDraft,
    initializeFromHints,
    save,
  } = useRepoSetupModalState(sourceRoot);

  const { data: detectionResult, isLoading: isDetecting } =
    useDetectProjectSetupQuery({ workspaceId });
  const { data: branchRefs = EMPTY_BRANCHES } = useGitBranchesQuery({ workspaceId });

  // Initialize script from hints once (build tools ON, secrets OFF)
  useEffect(() => {
    if (!hintsInitialized.current && detectionResult?.hints) {
      initializeFromHints(detectionResult.hints);
      hintsInitialized.current = true;
    }
  }, [detectionResult, initializeFromHints]);

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

  const branchButtonLabel = branchDraft
    ? branchDraft
    : autoDetectedBranch
      ? `Auto-detect (${autoDetectedBranch})`
      : "Auto-detect";

  const branchOptions = useMemo(() => [
    {
      id: "__auto__",
      label: "Auto-detect",
      detail: autoDetectedBranch ? `Currently ${autoDetectedBranch}` : "No branches found",
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
      title={`Set up: ${repoName}`}
      description="Configure default branch and worktree setup commands."
      sizeClassName="max-w-lg"
      footer={
        <>
          <button
            type="button"
            onClick={handleSkip}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90"
          >
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Branch picker */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Default branch</p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setBranchMenuOpen((o) => !o)}
              className="flex h-8 w-full items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate text-left">{branchButtonLabel}</span>
              <ChevronUpDown className="size-3 shrink-0 text-muted-foreground" />
            </button>
            {branchMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setBranchMenuOpen(false)} />
                <div className="absolute top-full left-0 z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
                  {branchOptions.map((option) => {
                    const selected = option.id === "__auto__"
                      ? branchDraft === null
                      : branchDraft === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setBranchDraft(option.id === "__auto__" ? null : option.id);
                          setBranchMenuOpen(false);
                        }}
                        className={`flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted/50 ${
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
              </>
            )}
          </div>
        </div>

        {/* Setup commands */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Worktree setup commands</p>
          <SetupCommandEditor
            hints={detectionResult?.hints ?? []}
            currentScript={scriptDraft}
            onChange={setScriptDraft}
            isLoading={isDetecting}
          />
          <p className="mt-2 text-xs text-muted-foreground/80">
            Available vars: <code>PROLIFERATE_WORKTREE_DIR</code>, <code>PROLIFERATE_REPO_DIR</code>,{" "}
            <code>PROLIFERATE_BRANCH</code>, <code>PROLIFERATE_BASE_REF</code>.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
