import type {
  WorktreeGitStatusSummary,
  WorktreeInventoryRow,
  WorktreeStorageEstimate,
} from "@anyharness/sdk";

export interface WorktreeGitStatusView {
  label: string;
  detail: string | null;
  tone: "neutral" | "success" | "warning" | "destructive";
}

export function worktreeRowLabel(row: WorktreeInventoryRow): string {
  const primaryWorkspace = row.associatedWorkspaces[0] ?? null;
  return primaryWorkspace?.displayName
    ?? primaryWorkspace?.branch
    ?? row.branch
    ?? row.repoRootName
    ?? row.state.replaceAll("_", " ");
}

export function worktreeRowSearchText(row: WorktreeInventoryRow): string {
  return [
    row.id,
    row.path,
    row.canonicalPath,
    row.branch,
    row.repoRootId,
    row.repoRootName,
    row.state,
    row.gitStatus?.state,
    row.gitStatus?.branch,
    row.gitStatus?.upstreamBranch,
    ...row.associatedWorkspaces.flatMap((workspace) => [
      workspace.id,
      workspace.displayName,
      workspace.branch,
      workspace.kind,
      workspace.lifecycleState,
      workspace.cleanupState,
      workspace.cleanupOperation,
    ]),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function worktreeGitStatusView(
  status: WorktreeGitStatusSummary | null | undefined,
): WorktreeGitStatusView {
  if (!status) {
    return {
      label: "Git unknown",
      detail: null,
      tone: "neutral",
    };
  }

  if (status.state === "conflicted") {
    return {
      label: "Conflicts",
      detail: fileCountDetail(status),
      tone: "destructive",
    };
  }

  if (status.state === "dirty") {
    return {
      label: "Changes",
      detail: fileCountDetail(status),
      tone: "warning",
    };
  }

  if (status.state === "clean") {
    return {
      label: "Clean",
      detail: branchDivergenceDetail(status),
      tone: "success",
    };
  }

  return {
    label: "Git unknown",
    detail: status.errorMessage ?? null,
    tone: "neutral",
  };
}

export function formatWorktreeStorage(storage: WorktreeStorageEstimate | null | undefined): string {
  const totalBytes = storage?.totalBytes;
  if (typeof totalBytes === "number" && Number.isFinite(totalBytes)) {
    return `~${formatBytes(totalBytes)}`;
  }
  return "Size unknown";
}

export function formatWorktreeStorageDetail(
  storage: WorktreeStorageEstimate | null | undefined,
): string | null {
  if (!storage) {
    return null;
  }
  const parts: string[] = [];
  if (typeof storage.worktreeBytes === "number" && Number.isFinite(storage.worktreeBytes)) {
    parts.push(`~${formatBytes(storage.worktreeBytes)} checkout`);
  }
  if (typeof storage.sqliteBytes === "number" && Number.isFinite(storage.sqliteBytes)) {
    parts.push(`~${formatBytes(storage.sqliteBytes)} history`);
  }
  return parts.length > 0 ? parts.join(" + ") : null;
}

function fileCountDetail(status: WorktreeGitStatusSummary): string | null {
  const parts: string[] = [];
  if (status.changedFileCount > 0) {
    parts.push(`${status.changedFileCount} changed`);
  }
  if (status.untrackedFileCount > 0) {
    parts.push(`${status.untrackedFileCount} untracked`);
  }
  const divergence = branchDivergenceDetail(status);
  if (divergence) {
    parts.push(divergence);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function branchDivergenceDetail(status: WorktreeGitStatusSummary): string | null {
  const parts: string[] = [];
  if (status.ahead > 0) {
    parts.push(`${status.ahead} ahead`);
  }
  if (status.behind > 0) {
    parts.push(`${status.behind} behind`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function formatBytes(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value / 1024;
  let unitIndex = 0;
  while (Math.abs(scaled) >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  const digits = Math.abs(scaled) >= 10 ? 0 : 1;
  return `${scaled.toFixed(digits)} ${units[unitIndex]}`;
}
