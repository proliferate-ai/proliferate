function encodeLogicalSegment(value: string): string {
  return encodeURIComponent(value);
}

function decodeLogicalSegment(value: string): string {
  return decodeURIComponent(value);
}

export function normalizeLogicalWorkspaceBranchKey(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "HEAD";
}

export type LogicalWorkspaceIdKind =
  | "remote"
  | "repo-root"
  | "path"
  | "local-slot"
  | "cloud";

export interface ParsedLogicalWorkspaceId {
  kind: LogicalWorkspaceIdKind;
  segments: string[];
}

export function buildRemoteLogicalWorkspaceId(
  provider: string,
  owner: string,
  repo: string,
  branchKey: string,
): string {
  return [
    "remote",
    encodeLogicalSegment(provider),
    encodeLogicalSegment(owner),
    encodeLogicalSegment(repo),
    encodeLogicalSegment(branchKey),
  ].join(":");
}

export function buildRepoRootLogicalWorkspaceId(
  repoRootId: string,
  branchKey: string,
): string {
  return [
    "repo-root",
    encodeLogicalSegment(repoRootId),
    encodeLogicalSegment(branchKey),
  ].join(":");
}

export function buildPathLogicalWorkspaceId(
  path: string,
  branchKey: string,
): string {
  return [
    "path",
    encodeLogicalSegment(path),
    encodeLogicalSegment(branchKey),
  ].join(":");
}

export function buildLocalSlotLogicalWorkspaceId(workspaceId: string): string {
  return [
    "local-slot",
    encodeLogicalSegment(workspaceId),
  ].join(":");
}

/**
 * Identity-keyed id for a Cloud workspace that carries an explicit
 * materialization ledger but no local link on this install (PR 5). Keyed by
 * `CloudWorkspace.id` so it is stable and never heuristically merged onto a
 * local slot by repository/branch. Distinct from the `remote:` branch-heuristic
 * key so legacy Cloud rows and explicit rows never collide.
 */
export function buildCloudIdentityLogicalWorkspaceId(cloudWorkspaceId: string): string {
  return [
    "cloud",
    encodeLogicalSegment(cloudWorkspaceId),
  ].join(":");
}

export function parseLogicalWorkspaceId(
  logicalWorkspaceId: string | null | undefined,
): ParsedLogicalWorkspaceId | null {
  if (!logicalWorkspaceId) {
    return null;
  }

  const [kind, ...encodedSegments] = logicalWorkspaceId.split(":");
  if (
    kind !== "remote"
    && kind !== "repo-root"
    && kind !== "path"
    && kind !== "local-slot"
    && kind !== "cloud"
  ) {
    return null;
  }

  let segments: string[];
  try {
    segments = encodedSegments.map(decodeLogicalSegment);
  } catch {
    return null;
  }

  if (
    (kind === "remote" && segments.length !== 4)
    || ((kind === "repo-root" || kind === "path") && segments.length !== 2)
    || (kind === "cloud" && segments.length !== 1)
  ) {
    return null;
  }

  if (kind === "local-slot") {
    if (segments.length !== 1) {
      return null;
    }
    const [workspaceId] = segments;
    if (
      !workspaceId
      || workspaceId === "."
      || workspaceId === ".."
      || workspaceId.includes("/")
      || workspaceId.includes("\\")
      || workspaceId.includes(":")
    ) {
      return null;
    }
  }

  return {
    kind,
    segments,
  };
}

export function replaceLogicalWorkspaceBranch(
  logicalWorkspaceId: string | null | undefined,
  branchKey: string,
): string | null {
  const parsed = parseLogicalWorkspaceId(logicalWorkspaceId);
  if (!parsed) {
    return null;
  }

  const nextBranchKey = normalizeLogicalWorkspaceBranchKey(branchKey);
  if (parsed.kind === "local-slot" || parsed.kind === "cloud") {
    // A local-slot / cloud-identity ID is keyed by workspace id; branch
    // identity is read from the underlying workspace row, not the id.
    return logicalWorkspaceId ?? null;
  }

  if (parsed.kind === "remote" && parsed.segments.length === 4) {
    const [provider, owner, repo] = parsed.segments;
    return buildRemoteLogicalWorkspaceId(provider!, owner!, repo!, nextBranchKey);
  }

  if (parsed.kind === "repo-root" && parsed.segments.length === 2) {
    return buildRepoRootLogicalWorkspaceId(parsed.segments[0]!, nextBranchKey);
  }

  if (parsed.kind === "path" && parsed.segments.length === 2) {
    return buildPathLogicalWorkspaceId(parsed.segments[0]!, nextBranchKey);
  }

  return null;
}
