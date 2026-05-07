import type {
  GitChangedFile,
  GitDiffFile,
  RepoRoot,
} from "@anyharness/sdk";

export type GitPanelMode = "working_tree_composite" | "unstaged" | "staged" | "branch";
export type GitPanelSectionScope = "unstaged" | "staged" | "branch";

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

export interface GitPanelSection {
  scope: GitPanelSectionScope;
  label: string;
  files: GitPanelFile[];
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
  { id: "working_tree_composite", label: "Working tree" },
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

export function buildGitPanelSections(input: BuildGitPanelFilesInput): GitPanelSection[] {
  if (input.mode === "working_tree_composite") {
    return [
      {
        scope: "unstaged" as const,
        label: "Unstaged",
        files: buildGitPanelFiles({ ...input, mode: "unstaged" }),
      },
      {
        scope: "staged" as const,
        label: "Staged",
        files: buildGitPanelFiles({ ...input, mode: "staged" }),
      },
    ].filter((section) => section.files.length > 0);
  }
  const scope: GitPanelSectionScope = input.mode;
  return [{
    scope,
    label: gitPanelModeLabel(input.mode),
    files: buildGitPanelFiles(input),
  }];
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
  if (mode === "working_tree_composite") {
    return "Working tree clean";
  }
  if (mode === "staged") {
    return "No staged changes";
  }
  if (mode === "branch") {
    return "No branch changes";
  }
  return "No unstaged changes";
}

export function gitPanelRuntimeBlockWorkspaceId(
  selectedWorkspaceId: string | null,
  _selectedLogicalWorkspaceId: string | null,
): string | null {
  return selectedWorkspaceId;
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
