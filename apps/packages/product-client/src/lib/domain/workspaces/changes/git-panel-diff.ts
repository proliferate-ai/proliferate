import type {
  GitChangedFile,
  GitDiffFile,
  RepoRoot,
} from "@anyharness/sdk";
import type { LastTurnTouchedFile } from "@proliferate/product-domain/chats/transcript/last-turn-file-changes";

export type GitPanelMode = "working_tree_composite" | "unstaged" | "staged" | "branch" | "last_turn";
export type GitPanelSectionScope = "unstaged" | "staged" | "branch";
export type GitPanelReviewScope = GitPanelSectionScope | "last_turn";

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
  scope: GitPanelReviewScope;
  label: string;
  files: GitPanelReviewFile[];
}

export interface GitPanelReviewFile {
  key: string;
  path: string;
  oldPath: string | null;
  displayPath: string;
  currentDiff: GitPanelFile | null;
  touched?: LastTurnTouchedFile;
}

export interface BuildGitPanelFilesInput {
  mode: GitPanelMode;
  statusFiles: readonly GitChangedFile[];
  branchFiles: readonly GitDiffFile[];
  lastTurnFiles?: readonly LastTurnTouchedFile[];
  baseWorktreeFiles?: readonly GitDiffFile[];
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
  { id: "last_turn", label: "Last turn" },
];

export function buildGitPanelFiles({
  mode,
  statusFiles,
  branchFiles,
  lastTurnFiles,
  baseWorktreeFiles,
}: BuildGitPanelFilesInput): GitPanelFile[] {
  if (mode === "branch") {
    return branchFiles
      .filter((file) => isVisibleGitPath(file.path))
      .map((file) => toPanelFile(file, null));
  }
  if (mode === "last_turn") {
    const currentByPath = new Map(
      (baseWorktreeFiles ?? [])
        .filter((file) => isVisibleGitPath(file.path))
        .map((file) => [file.path, toPanelFile(file, null)]),
    );
    return (lastTurnFiles ?? [])
      .filter((file) => isVisibleGitPath(file.path))
      .map((file) => currentByPath.get(file.path))
      .filter((file): file is GitPanelFile => Boolean(file));
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
        files: buildGitPanelFiles({ ...input, mode: "unstaged" }).map(toReviewFile),
      },
      {
        scope: "staged" as const,
        label: "Staged",
        files: buildGitPanelFiles({ ...input, mode: "staged" }).map(toReviewFile),
      },
    ].filter((section) => section.files.length > 0);
  }
  if (input.mode === "last_turn") {
    const currentByPath = new Map(
      (input.baseWorktreeFiles ?? [])
        .filter((file) => isVisibleGitPath(file.path))
        .map((file) => [file.path, toPanelFile(file, null)]),
    );
    return [{
      scope: "last_turn" as const,
      label: "Last turn",
      files: (input.lastTurnFiles ?? [])
        .filter((file) => isVisibleGitPath(file.path))
        .map((file) =>
          toLastTurnReviewFile(file, currentByPath.get(file.path) ?? null)
        ),
    }];
  }
  const scope: GitPanelSectionScope = input.mode;
  return [{
    scope,
    label: gitPanelModeLabel(input.mode),
    files: buildGitPanelFiles(input).map(toReviewFile),
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
  if (mode === "last_turn") {
    return "No file changes in last turn";
  }
  return "No unstaged changes";
}

export function gitPanelEmptyDescription(
  mode: GitPanelMode,
  baseRef: string | null | undefined,
): string {
  if (mode === "working_tree_composite") {
    return "No unstaged or staged changes in this workspace.";
  }
  if (mode === "staged") {
    return "Stage files to collect them here before committing.";
  }
  if (mode === "branch") {
    return `No committed changes relative to ${baseRef?.trim() || "the selected base"}.`;
  }
  if (mode === "last_turn") {
    return "The latest completed turn did not report top-level file edits.";
  }
  return "Edit files in the workspace and they will appear here.";
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

export function toReviewFile(file: GitPanelFile): GitPanelReviewFile {
  return {
    key: file.key,
    path: file.path,
    oldPath: file.oldPath,
    displayPath: file.displayPath,
    currentDiff: file,
  };
}

function toLastTurnReviewFile(
  touched: LastTurnTouchedFile,
  currentDiff: GitPanelFile | null,
): GitPanelReviewFile {
  return {
    key: touched.key,
    path: touched.path,
    oldPath: currentDiff?.oldPath ?? touched.oldPath,
    displayPath: touched.displayPath,
    currentDiff,
    touched,
  };
}

function isVisibleGitPath(path: string): boolean {
  return path.length > 0 && !path.startsWith(".claude/worktrees/");
}

function normalizeBaseRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
