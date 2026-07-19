import { useEffect, useRef, useState } from "react";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import {
  useStatWorkspaceFileQuery,
  useWorkspaceFilesQuery,
} from "@anyharness/sdk-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { FileTreeRow } from "#product/components/workspace/files/tree/FileTreeRow";
import { resolveWorkspaceStatPathKind } from "#product/lib/domain/files/path-references";
import { useFileTreeStore } from "#product/stores/editor/file-tree-store";

interface FileTreeDirectoryProps {
  workspaceId: string | null;
  path: string;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  changedPaths?: Set<string>;
  level: number;
}

export function FileTreeDirectory({
  workspaceId,
  path,
  selectedPath,
  onOpenFile,
  changedPaths,
  level,
}: FileTreeDirectoryProps) {
  const expandedPaths = useFileTreeStore((s) => s.expandedPaths);
  const toggleExpanded = useFileTreeStore((s) => s.toggleExpanded);

  const filesQuery = useWorkspaceFilesQuery({
    workspaceId,
    path,
    enabled: Boolean(workspaceId),
  });

  const entries = filesQuery.data?.entries ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const unavailable = !workspaceId;
  const loading = Boolean(workspaceId && filesQuery.isLoading);
  const failed = Boolean(workspaceId && filesQuery.error);

  // Only virtualize the root level. Expanded directories remain inside their
  // root virtual item, whose dynamic height is measured after each async load.
  if (level === 0) {
    return (
      <div
        ref={scrollRef}
        role="tree"
        aria-busy={loading || undefined}
        className="file-tree-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1"
      >
        {unavailable ? (
          <FileTreeStatus message="Files are unavailable for this workspace." />
        ) : loading ? (
          <FileTreeStatus message="Loading files…" />
        ) : failed ? (
          <FileTreeStatus message="Files could not be loaded." tone="error" />
        ) : entries.length === 0 ? (
          <FileTreeStatus message="This folder is empty." />
        ) : (
          <VirtualizedTree
            scrollRef={scrollRef}
            entries={entries}
            workspaceId={workspaceId}
            selectedPath={selectedPath}
            onOpenFile={onOpenFile}
            changedPaths={changedPaths}
            expandedPaths={expandedPaths}
            toggleExpanded={toggleExpanded}
            level={level}
          />
        )}
      </div>
    );
  }

  return (
    <div role="group">
      {loading ? (
        <FileTreeStatus message="Loading…" level={level} compact />
      ) : failed ? (
        <FileTreeStatus message="Folder unavailable" level={level} compact tone="error" />
      ) : entries.length === 0 ? (
        <FileTreeStatus message="Empty folder" level={level} compact />
      ) : entries.map((entry) => (
        <FileTreeEntryRow
          key={entry.path}
          entry={entry}
          workspaceId={workspaceId}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          changedPaths={changedPaths}
          expandedPaths={expandedPaths}
          toggleExpanded={toggleExpanded}
          level={level}
        />
      ))}
    </div>
  );
}

function VirtualizedTree({
  scrollRef,
  entries,
  workspaceId,
  selectedPath,
  onOpenFile,
  changedPaths,
  expandedPaths,
  toggleExpanded,
  level,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  entries: readonly WorkspaceFileEntry[];
  workspaceId: string | null;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  changedPaths?: Set<string>;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  level: number;
}) {
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => entries[index]?.path ?? index,
    estimateSize: () => 28,
    overscan: 20,
    // jsdom (tests) and pre-layout frames report a zero-height scroll
    // element; seed a viewport so initial rows render.
    initialRect: { width: 400, height: 800 },
    measureElement: (element) => element.getBoundingClientRect().height || 28,
  });

  useEffect(() => {
    const selectedRootIndex = entries.findIndex((entry) =>
      entry.path === selectedPath || selectedPath.startsWith(`${entry.path}/`)
    );
    if (selectedRootIndex >= 0) {
      virtualizer.scrollToIndex(selectedRootIndex, { align: "auto" });
    }
  }, [entries, selectedPath, virtualizer]);

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const entry = entries[virtualItem.index]!;
        return (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <FileTreeEntryRow
              entry={entry}
              workspaceId={workspaceId}
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
              changedPaths={changedPaths}
              expandedPaths={expandedPaths}
              toggleExpanded={toggleExpanded}
              level={level}
            />
          </div>
        );
      })}
    </div>
  );
}

function FileTreeStatus({
  message,
  level = 0,
  compact = false,
  tone = "muted",
}: {
  message: string;
  level?: number;
  compact?: boolean;
  tone?: "muted" | "error";
}) {
  return (
    <p
      role="status"
      className={twMerge(
        "flex items-center text-[length:var(--text-message)] text-sidebar-muted-foreground",
        compact ? "h-7" : "px-1 py-3",
        tone === "error" && "text-destructive",
      )}
      style={compact ? { paddingLeft: 28 + level * 14 } : undefined}
    >
      {message}
    </p>
  );
}

interface FileTreeEntryRowProps {
  entry: WorkspaceFileEntry;
  workspaceId: string | null;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  changedPaths?: Set<string>;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  level: number;
}

function FileTreeEntryRow(props: FileTreeEntryRowProps) {
  if (props.entry.kind === "symlink") {
    return <SymlinkFileTreeEntryRow {...props} />;
  }
  return <ResolvedFileTreeEntryRow {...props} kind={props.entry.kind} />;
}

function SymlinkFileTreeEntryRow({
  entry,
  workspaceId,
  selectedPath,
  onOpenFile,
  changedPaths,
  expandedPaths,
  toggleExpanded,
  level,
}: FileTreeEntryRowProps) {
  const shouldResolveSymlink = (
    expandedPaths.has(entry.path)
    || selectedPath.startsWith(`${entry.path}/`)
  );
  const symlinkStatQuery = useStatWorkspaceFileQuery({
    workspaceId,
    path: entry.path,
    enabled: Boolean(workspaceId && shouldResolveSymlink),
  });
  const [resolvedSymlinkKind, setResolvedSymlinkKind] = useState<"file" | "directory" | null>(
    null,
  );
  const symlinkTargetKind = resolveWorkspaceStatPathKind(symlinkStatQuery.data)
    ?? resolvedSymlinkKind;

  const handleEntryClick = async () => {
    let targetKind = symlinkTargetKind;
    if (!targetKind) {
      const result = await symlinkStatQuery.refetch();
      targetKind = resolveWorkspaceStatPathKind(result.data);
      setResolvedSymlinkKind(targetKind);
    }
    if (targetKind === "directory") {
      toggleExpanded(entry.path);
    } else if (targetKind === "file") {
      onOpenFile(entry.path);
    }
  };

  return (
    <ResolvedFileTreeEntryRow
      entry={entry}
      workspaceId={workspaceId}
      selectedPath={selectedPath}
      onOpenFile={onOpenFile}
      changedPaths={changedPaths}
      expandedPaths={expandedPaths}
      toggleExpanded={toggleExpanded}
      level={level}
      kind={symlinkTargetKind ?? "symlink"}
      busy={symlinkStatQuery.isFetching}
      onClick={() => void handleEntryClick()}
    />
  );
}

function ResolvedFileTreeEntryRow({
  entry,
  workspaceId,
  selectedPath,
  onOpenFile,
  changedPaths,
  expandedPaths,
  toggleExpanded,
  level,
  kind,
  busy = false,
  onClick,
}: FileTreeEntryRowProps & {
  kind: "file" | "directory" | "symlink";
  busy?: boolean;
  onClick?: () => void;
}) {
  const isDirectory = kind === "directory";
  const expanded = isDirectory && expandedPaths.has(entry.path);

  return (
    <div>
      <FileTreeRow
        name={entry.name}
        path={entry.path}
        kind={kind}
        level={level}
        selected={!isDirectory && entry.path === selectedPath}
        expanded={isDirectory ? expanded : undefined}
        changed={changedPaths?.has(entry.path)}
        busy={busy}
        onClick={onClick ?? (() => {
          if (isDirectory) {
            toggleExpanded(entry.path);
          } else {
            onOpenFile(entry.path);
          }
        })}
      />
      {isDirectory && expanded && (
        <FileTreeDirectory
          workspaceId={workspaceId}
          path={entry.path}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          changedPaths={changedPaths}
          level={level + 1}
        />
      )}
    </div>
  );
}
