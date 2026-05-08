import type {
  GitBranchDiffFilesResponse,
  GitChangedFile,
} from "@anyharness/sdk";
import {
  fileDiffViewerTarget,
  type FileDiffViewerScope,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";

export type FileDiffTarget = Extract<ViewerTarget, { kind: "fileDiff" }>;

export interface DiffScopeOption {
  scope: FileDiffViewerScope;
  label: string;
  description: string;
  target: FileDiffTarget;
}

export function diffScopeFromIncludedState(
  includedState: "included" | "excluded" | "partial",
): FileDiffViewerScope {
  return includedState === "included" ? "staged" : "unstaged";
}

export function buildDiffScopeOptions({
  filePath,
  statusFile,
  branchDiff,
  explicitTarget,
}: {
  filePath: string;
  statusFile: GitChangedFile | null;
  branchDiff: GitBranchDiffFilesResponse | undefined;
  explicitTarget?: FileDiffTarget;
}): DiffScopeOption[] {
  const byScope = new Map<FileDiffViewerScope, DiffScopeOption>();

  if (statusFile) {
    for (const scope of diffScopesForStatusFile(statusFile)) {
      byScope.set(scope, {
        scope,
        label: diffScopeLabel(scope),
        description: diffScopeDescription(scope, null),
        target: fileDiffViewerTarget({
          path: statusFile.path,
          oldPath: statusFile.oldPath ?? null,
          scope,
        }) as FileDiffTarget,
      });
    }
  }

  const branchFile = branchDiff?.files.find((file) =>
    file.path === filePath || file.oldPath === filePath
  );
  if (branchDiff && branchFile) {
    const scope = "branch" as const;
    byScope.set(scope, {
      scope,
      label: diffScopeLabel(scope),
      description: diffScopeDescription(scope, branchDiff.baseRef),
      target: fileDiffViewerTarget({
        path: branchFile.path,
        oldPath: branchFile.oldPath ?? null,
        scope,
        baseRef: branchDiff.baseRef,
        baseOid: branchDiff.mergeBaseOid,
        headOid: branchDiff.headOid,
      }) as FileDiffTarget,
    });
  }

  if (explicitTarget && !byScope.has(explicitTarget.scope)) {
    byScope.set(explicitTarget.scope, {
      scope: explicitTarget.scope,
      label: diffScopeLabel(explicitTarget.scope),
      description: diffScopeDescription(explicitTarget.scope, explicitTarget.baseRef),
      target: explicitTarget,
    });
  }

  return (["unstaged", "staged", "branch"] as const)
    .flatMap((scope) => byScope.get(scope) ? [byScope.get(scope)!] : []);
}

export function resolveActiveDiffOption(
  options: readonly DiffScopeOption[],
  selectedScope: FileDiffViewerScope | null,
  preferredScope: FileDiffViewerScope | null,
): DiffScopeOption | null {
  return (
    options.find((option) => option.scope === selectedScope)
    ?? options.find((option) => option.scope === preferredScope)
    ?? options[0]
    ?? null
  );
}

function diffScopesForStatusFile(file: GitChangedFile): FileDiffViewerScope[] {
  if (file.includedState === "partial") {
    return ["unstaged", "staged"];
  }
  return file.includedState === "included" ? ["staged"] : ["unstaged"];
}

function diffScopeLabel(scope: FileDiffViewerScope): string {
  if (scope === "staged") {
    return "Staged";
  }
  if (scope === "branch") {
    return "Branch";
  }
  return "Unstaged";
}

function diffScopeDescription(scope: FileDiffViewerScope, baseRef: string | null): string {
  if (scope === "staged") {
    return "Index changes";
  }
  if (scope === "branch") {
    return baseRef ? `Compared with ${baseRef}` : "Branch changes";
  }
  return "Working tree changes";
}
