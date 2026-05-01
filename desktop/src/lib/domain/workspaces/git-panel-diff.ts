import type {
  GitChangedFile,
  GitDiffFile,
  GitDiffScope,
  RepoRoot,
} from "@anyharness/sdk";

export type GitPanelMode = "unstaged" | "staged" | "branch";
export type GitPanelOpenAction = "diff" | "file" | "disabled";

export interface GitPanelFile {
  key: string;
  path: string;
  oldPath: string | null;
  displayPath: string;
  status: GitChangedFile["status"] | GitDiffFile["status"];
  includedState: GitChangedFile["includedState"] | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface BuildGitPanelFilesInput {
  mode: GitPanelMode;
  statusFiles: readonly GitChangedFile[];
  branchFiles: readonly GitDiffFile[];
}

export interface ResolveGitPanelBaseRefInput {
  repoPreferenceDefaultBranch?: string | null;
  repoRootDefaultBranch?: string | null;
  suggestedBaseBranch?: string | null;
}

export const GIT_PANEL_MODE_OPTIONS: { id: GitPanelMode; label: string }[] = [
  { id: "unstaged", label: "Unstaged" },
  { id: "staged", label: "Staged" },
  { id: "branch", label: "This branch" },
];

export function buildGitPanelFiles({
  mode,
  statusFiles,
  branchFiles,
}: BuildGitPanelFilesInput): GitPanelFile[] {
  if (mode === "branch") {
    return branchFiles
      .filter((file) => isVisibleGitPath(file.path))
      .map((file) => toPanelFile(file, null));
  }

  const includedStates = mode === "staged"
    ? new Set<GitChangedFile["includedState"]>(["included", "partial"])
    : new Set<GitChangedFile["includedState"]>(["excluded", "partial"]);

  return statusFiles
    .filter((file) => isVisibleGitPath(file.path))
    .filter((file) => includedStates.has(file.includedState))
    .map((file) => toPanelFile(file, file.includedState));
}

export function countVisibleStatusFiles(statusFiles: readonly GitChangedFile[]): number {
  return statusFiles.filter((file) => isVisibleGitPath(file.path)).length;
}

export function resolveGitPanelBaseRef({
  repoPreferenceDefaultBranch,
  repoRootDefaultBranch,
  suggestedBaseBranch,
}: ResolveGitPanelBaseRefInput): string | null {
  return normalizeBaseRef(repoPreferenceDefaultBranch)
    ?? normalizeBaseRef(repoRootDefaultBranch)
    ?? normalizeBaseRef(suggestedBaseBranch)
    ?? null;
}

export function gitPanelModeLabel(mode: GitPanelMode): string {
  return GIT_PANEL_MODE_OPTIONS.find((option) => option.id === mode)?.label ?? "Unstaged";
}

export function gitPanelEmptyMessage(mode: GitPanelMode): string {
  if (mode === "staged") {
    return "No staged changes";
  }
  if (mode === "branch") {
    return "No branch changes";
  }
  return "No unstaged changes";
}

export function gitPanelDiffScope(mode: GitPanelMode): GitDiffScope {
  if (mode === "staged") {
    return "staged";
  }
  if (mode === "branch") {
    return "branch";
  }
  return "unstaged";
}

export function gitPanelRuntimeBlockWorkspaceId(
  selectedWorkspaceId: string | null,
  _selectedLogicalWorkspaceId: string | null,
): string | null {
  return selectedWorkspaceId;
}

export function gitPanelOpenAction(mode: GitPanelMode, file: GitPanelFile): GitPanelOpenAction {
  if (mode !== "branch") {
    return "diff";
  }
  return file.status === "deleted" ? "disabled" : "file";
}

export function sourceRootForGitPanel(
  sourceRoot: string | null | undefined,
  workspacePath: string | null | undefined,
): string | null {
  return normalizeBaseRef(sourceRoot) ?? normalizeBaseRef(workspacePath);
}

export function repoRootDefaultBranch(repoRoot: Pick<RepoRoot, "defaultBranch"> | null | undefined) {
  return repoRoot?.defaultBranch ?? null;
}

function toPanelFile(
  file: GitChangedFile | GitDiffFile,
  includedState: GitChangedFile["includedState"] | null,
): GitPanelFile {
  const oldPath = file.oldPath ?? null;
  const displayPath = oldPath ? `${oldPath} -> ${file.path}` : file.path;
  return {
    key: `${oldPath ?? ""}:${file.path}:${file.status}`,
    path: file.path,
    oldPath,
    displayPath,
    status: file.status,
    includedState,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
  };
}

function isVisibleGitPath(path: string): boolean {
  return path.length > 0 && !path.startsWith(".claude/worktrees/");
}

function normalizeBaseRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
