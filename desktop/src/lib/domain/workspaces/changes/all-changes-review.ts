import type {
  GitChangedFile,
  GitDiffFile,
} from "@anyharness/sdk";
import {
  buildGitPanelFiles,
  gitPanelModeLabel,
  type GitPanelFile,
  type GitPanelSectionScope,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import type { ViewerTarget } from "@/lib/domain/workspaces/viewer/viewer-target";

export type AllChangesTarget = Extract<ViewerTarget, { kind: "allChanges" }>;

export type AllChangesRow =
  | {
    kind: "section";
    key: string;
    sectionScope: GitPanelSectionScope;
    label: string;
    count: number;
    collapsed: boolean;
  }
  | {
    kind: "file";
    key: string;
    sectionScope: GitPanelSectionScope;
    file: GitPanelFile;
    collapsed: boolean;
  };

export interface AllChangesFrameHeaderModel {
  title: string;
  subtitle: string;
}

export function buildAllChangesRows({
  branchFiles,
  collapsedFiles,
  collapsedSections,
  statusFiles,
  target,
}: {
  branchFiles: readonly GitDiffFile[];
  collapsedFiles: ReadonlySet<string>;
  collapsedSections: ReadonlySet<GitPanelSectionScope>;
  statusFiles: readonly GitChangedFile[];
  target: Pick<AllChangesTarget, "scope">;
}): AllChangesRow[] {
  if (target.scope === "branch") {
    return sectionRows({
      scope: "branch",
      label: gitPanelModeLabel("branch"),
      files: buildGitPanelFiles({
        mode: "branch",
        statusFiles: [],
        branchFiles,
      }),
      collapsedSections,
      collapsedFiles,
    });
  }

  if (target.scope === "working_tree_composite") {
    return [
      ...sectionRows({
        scope: "unstaged",
        label: "Unstaged",
        files: buildGitPanelFiles({
          mode: "unstaged",
          statusFiles,
          branchFiles: [],
        }),
        collapsedSections,
        collapsedFiles,
      }),
      ...sectionRows({
        scope: "staged",
        label: "Staged",
        files: buildGitPanelFiles({
          mode: "staged",
          statusFiles,
          branchFiles: [],
        }),
        collapsedSections,
        collapsedFiles,
      }),
    ];
  }

  return sectionRows({
    scope: target.scope,
    label: gitPanelModeLabel(target.scope),
    files: buildGitPanelFiles({
      mode: target.scope,
      statusFiles,
      branchFiles: [],
    }),
    collapsedSections,
    collapsedFiles,
  });
}

export function countAllChangesFiles(rows: readonly AllChangesRow[]): number {
  return rows.reduce(
    (count, row) => row.kind === "section" ? count + row.count : count,
    0,
  );
}

export function resolveAllChangesFrameHeader(
  target: Pick<AllChangesTarget, "scope">,
): AllChangesFrameHeaderModel {
  if (target.scope === "working_tree_composite") {
    return {
      title: "All changes",
      subtitle: "Working tree",
    };
  }

  const label = gitPanelModeLabel(target.scope);
  return {
    title: `All ${label.toLowerCase()} changes`,
    subtitle: label,
  };
}

function sectionRows({
  scope,
  label,
  files,
  collapsedSections,
  collapsedFiles,
}: {
  scope: GitPanelSectionScope;
  label: string;
  files: GitPanelFile[];
  collapsedSections: ReadonlySet<GitPanelSectionScope>;
  collapsedFiles: ReadonlySet<string>;
}): AllChangesRow[] {
  if (files.length === 0) {
    return [];
  }

  const sectionCollapsed = collapsedSections.has(scope);
  const fileRows = sectionCollapsed
    ? []
    : files.map((file) => {
      const key = `file:${scope}:${file.key}`;
      return {
        kind: "file" as const,
        key,
        sectionScope: scope,
        file,
        collapsed: collapsedFiles.has(key),
      };
    });

  return [
    {
      kind: "section",
      key: `section:${scope}`,
      sectionScope: scope,
      label,
      count: files.length,
      collapsed: sectionCollapsed,
    },
    ...fileRows,
  ];
}
