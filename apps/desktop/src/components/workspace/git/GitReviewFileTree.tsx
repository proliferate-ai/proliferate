import { useMemo, useState } from "react";
import {
  PaneFileTree,
  PaneFileTreeBadge,
  type PaneFileTreeNode,
  type PaneFileTreeSection,
} from "@/components/workspace/pane/PaneFileTree";
import {
  buildChangedFileTree,
  type ChangedFileTreeNode,
} from "@/lib/domain/workspaces/changes/changed-file-tree";
import type {
  GitPanelReviewFile,
  GitPanelSection,
  GitPanelReviewScope,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import { getGitFileStatusPresentation } from "@/lib/domain/workspaces/changes/git-file-status-presentation";
import type { GitReviewFileEntry } from "@/lib/domain/workspaces/changes/git-review-entries";

interface GitReviewFileTreeProps {
  sections: GitPanelSection[];
  reviewEntries: GitReviewFileEntry[];
  onSelectFile: (entry: GitReviewFileEntry) => void;
}

interface TreeStats {
  additions: number;
  deletions: number;
  files: number;
}

export function GitReviewFileTree({
  sections,
  reviewEntries,
  onSelectFile,
}: GitReviewFileTreeProps) {
  const [search, setSearch] = useState("");
  const entryByScopeAndPath = useMemo(() => {
    const map = new Map<string, GitReviewFileEntry>();
    for (const entry of reviewEntries) {
      map.set(`${entry.sectionScope}:${entry.file.key}`, entry);
    }
    return map;
  }, [reviewEntries]);
  const filteredSections = useMemo(
    () => filterSections(sections, search),
    [search, sections],
  );
  const treeSections = useMemo<PaneFileTreeSection<GitReviewFileEntry>[]>(() =>
    filteredSections.map((section) => ({
      id: section.scope,
      label: sections.length > 1 ? section.label : undefined,
      trailing: sections.length > 1 ? (
        <GitReviewTreeStats stats={filesStats(section.files)} />
      ) : undefined,
      nodes: buildChangedFileTree(section.files).map((node) =>
        toPaneFileTreeNode({
          node,
          sectionScope: section.scope,
          entryByScopeAndPath,
        })
      ),
    })),
  [entryByScopeAndPath, filteredSections, sections.length]);

  return (
    <PaneFileTree
      sections={treeSections}
      searchValue={search}
      searchPlaceholder="Filter files"
      emptyMessage="No files"
      onSearchChange={setSearch}
      onSelectNode={(node) => {
        if (node.data) {
          onSelectFile(node.data);
        }
      }}
    />
  );
}

function toPaneFileTreeNode({
  node,
  sectionScope,
  entryByScopeAndPath,
}: {
  node: ChangedFileTreeNode<GitPanelReviewFile>;
  sectionScope: GitPanelReviewScope;
  entryByScopeAndPath: Map<string, GitReviewFileEntry>;
}): PaneFileTreeNode<GitReviewFileEntry> {
  if (node.kind === "directory") {
    return {
      id: `${sectionScope}:dir:${node.path}`,
      name: node.name,
      path: node.path,
      kind: "directory",
      expanded: true,
      trailing: <GitReviewTreeStats stats={nodeStats(node)} />,
      children: node.children.map((child) =>
        toPaneFileTreeNode({
          node: child,
          sectionScope,
          entryByScopeAndPath,
        })
      ),
    };
  }

  const file = node.file;
  const entry = entryByScopeAndPath.get(`${sectionScope}:${file.key}`);
  const baseName = file.displayPath.split("/").pop() ?? file.displayPath;
  return {
    id: `${sectionScope}:file:${file.key}`,
    name: baseName,
    path: file.path,
    kind: "file",
    title: file.displayPath,
    disabled: !entry,
    trailing: <GitReviewFileMeta file={file} />,
    data: entry,
  };
}

function GitReviewFileMeta({ file }: { file: GitPanelReviewFile }) {
  const currentDiff = file.currentDiff;
  if (!currentDiff) {
    return <PaneFileTreeBadge className="bg-sidebar-accent text-sidebar-muted-foreground">-</PaneFileTreeBadge>;
  }
  const status = getGitFileStatusPresentation(currentDiff.status);
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {(currentDiff.additions > 0 || currentDiff.deletions > 0) && (
        <span className="inline-flex items-center gap-1 tabular-nums tracking-tight">
          {currentDiff.additions > 0 && <span className="text-git-green">+{currentDiff.additions}</span>}
          {currentDiff.deletions > 0 && <span className="text-git-red">-{currentDiff.deletions}</span>}
        </span>
      )}
      <PaneFileTreeBadge className={status.className}>
        {status.label}
      </PaneFileTreeBadge>
    </span>
  );
}

function GitReviewTreeStats({ stats }: { stats: TreeStats }) {
  if (stats.additions > 0 || stats.deletions > 0) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] tabular-nums tracking-tight">
        {stats.additions > 0 && <span className="text-git-green">+{stats.additions}</span>}
        {stats.deletions > 0 && <span className="text-git-red">-{stats.deletions}</span>}
      </span>
    );
  }
  return (
    <PaneFileTreeBadge>{stats.files}</PaneFileTreeBadge>
  );
}

function filterSections(
  sections: readonly GitPanelSection[],
  search: string,
): GitPanelSection[] {
  const query = search.trim().toLowerCase();
  if (!query) {
    return [...sections];
  }
  return sections
    .map((section) => ({
      ...section,
      files: section.files.filter((file) =>
        file.displayPath.toLowerCase().includes(query)
        || file.path.toLowerCase().includes(query)
        || file.currentDiff?.status.toLowerCase().includes(query)
      ),
    }))
    .filter((section) => section.files.length > 0);
}

function nodeStats(node: ChangedFileTreeNode<GitPanelReviewFile>): TreeStats {
  if (node.kind === "file") {
    return filesStats([node.file]);
  }
  return node.children.reduce<TreeStats>((stats, child) => {
    const childStats = nodeStats(child);
    return {
      additions: stats.additions + childStats.additions,
      deletions: stats.deletions + childStats.deletions,
      files: stats.files + childStats.files,
    };
  }, { additions: 0, deletions: 0, files: 0 });
}

function filesStats(files: readonly GitPanelReviewFile[]): TreeStats {
  return files.reduce<TreeStats>((stats, file) => ({
    additions: stats.additions + (file.currentDiff?.additions ?? 0),
    deletions: stats.deletions + (file.currentDiff?.deletions ?? 0),
    files: stats.files + 1,
  }), { additions: 0, deletions: 0, files: 0 });
}
