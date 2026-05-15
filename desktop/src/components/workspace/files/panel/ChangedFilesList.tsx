import { Button } from "@/components/ui/Button";
import { FileChangeStats } from "@/components/ui/content/FileDiffCard";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { ArrowUpRight, ChevronRight } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  buildChangedFileTree,
  type ChangedFileTreeNode,
} from "@/lib/domain/workspaces/changes/changed-file-tree";
import type {
  GitPanelFile,
  GitPanelSectionScope,
} from "@/lib/domain/workspaces/changes/git-panel-diff";

type OpenFile = (path: string) => Promise<void>;
type OpenFileDiff = (
  path: string,
  options?: {
    scope?: GitPanelSectionScope | null;
    baseRef?: string | null;
    oldPath?: string | null;
  },
) => Promise<void>;

interface ChangedFilesListProps {
  sections: {
    scope: GitPanelSectionScope;
    label: string;
    files: GitPanelFile[];
  }[];
  baseRef: string | null;
  isBranchMode: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  runtimeBlockedReason: string | null;
  emptyMessage: string;
  changedFileCount: number;
  openFile: OpenFile;
  openFileDiff: OpenFileDiff;
}

export function ChangedFilesList({
  sections,
  baseRef,
  isBranchMode,
  isLoading,
  errorMessage,
  runtimeBlockedReason,
  emptyMessage,
  changedFileCount,
  openFile,
  openFileDiff,
}: ChangedFilesListProps) {
  return (
    <div className="h-full overflow-auto px-2 py-2">
      {isLoading && (
        <p className="px-2 py-3 text-xs text-sidebar-muted-foreground">Loading changed files...</p>
      )}
      {errorMessage && (
        <p className="px-2 py-3 text-xs text-destructive">{errorMessage}</p>
      )}
      {!errorMessage && runtimeBlockedReason && (
        <p className="px-2 py-3 text-xs text-sidebar-muted-foreground">
          {runtimeBlockedReason}
        </p>
      )}
      {!isLoading && !errorMessage && !runtimeBlockedReason && sections.length === 0 && (
        <p className="px-2 py-3 text-center text-xs text-sidebar-muted-foreground">
          {emptyMessage}
        </p>
      )}
      {!isLoading && !errorMessage && !runtimeBlockedReason && sections.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="px-1 text-xs text-sidebar-muted-foreground">
            {changedFileCount} changed file{changedFileCount === 1 ? "" : "s"}
          </p>
          {sections.map((section) => {
            const tree = buildChangedFileTree(section.files);
            return (
              <div key={section.scope} className="flex flex-col gap-1">
                {sections.length > 1 && (
                  <div className="px-1 pt-1 text-xs font-[450] uppercase tracking-wide text-sidebar-muted-foreground">
                    {section.label}
                  </div>
                )}
                {tree.map((node) => (
                  <ChangedFileTreeNodeRow
                    key={`${section.scope}:${node.path}`}
                    node={node}
                    level={0}
                    sectionScope={section.scope}
                    baseRef={baseRef}
                    isBranchMode={isBranchMode}
                    openFile={openFile}
                    openFileDiff={openFileDiff}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChangedFileTreeNodeRow({
  node,
  level,
  sectionScope,
  baseRef,
  isBranchMode,
  openFile,
  openFileDiff,
}: {
  node: ChangedFileTreeNode<GitPanelFile>;
  level: number;
  sectionScope: GitPanelSectionScope;
  baseRef: string | null;
  isBranchMode: boolean;
  openFile: OpenFile;
  openFileDiff: OpenFileDiff;
}) {
  if (node.kind === "directory") {
    return (
      <div>
        <div
          className="mx-0 flex h-7 items-center gap-2 rounded-md px-2 text-[0.65rem] text-sidebar-muted-foreground"
          style={{ paddingLeft: `${8 + level * 14}px` }}
        >
          <ChevronRight className="size-3 shrink-0 rotate-90" />
          <FileTreeEntryIcon
            name={node.name}
            path={node.path}
            kind="directory"
            isExpanded
            className="size-3.5 shrink-0"
          />
          <span className="min-w-0 truncate">{node.name}</span>
        </div>
        {node.children.map((child) => (
          <ChangedFileTreeNodeRow
            key={child.path}
            node={child}
            level={level + 1}
            sectionScope={sectionScope}
            baseRef={baseRef}
            isBranchMode={isBranchMode}
            openFile={openFile}
            openFileDiff={openFileDiff}
          />
        ))}
      </div>
    );
  }

  const file = node.file;
  const baseName = file.displayPath.split("/").pop() ?? file.displayPath;
  return (
    <div
      className="group ml-2 flex items-center gap-1 rounded-md border border-sidebar-border/60 bg-sidebar-accent/20 pr-1 transition-colors hover:border-sidebar-border hover:bg-sidebar-accent/70"
      style={{ marginLeft: `${level * 14}px` }}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void openFile(file.path)}
        title={file.displayPath}
        className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md bg-transparent px-2 py-1.5 text-left hover:bg-transparent"
      >
        <FileTreeEntryIcon
          name={baseName}
          path={file.path}
          kind="file"
          className="size-3.5 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-[0.68rem] text-sidebar-foreground [direction:ltr] [unicode-bidi:plaintext]">
          {file.displayPath}
        </span>
        <FileChangeStats
          additions={file.additions}
          deletions={file.deletions}
          className="text-[10px]"
        />
      </Button>
      <Tooltip content="Open diff">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void openFileDiff(file.path, {
            scope: sectionScope,
            baseRef: isBranchMode ? baseRef : null,
            oldPath: isBranchMode ? file.oldPath : null,
          })}
          aria-label={`Open ${baseName} diff`}
          className="size-6 shrink-0 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <ArrowUpRight className="size-3" />
        </Button>
      </Tooltip>
    </div>
  );
}
