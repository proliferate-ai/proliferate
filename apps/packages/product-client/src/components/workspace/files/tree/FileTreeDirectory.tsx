import { useEffect, useRef, useState } from "react";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import {
  useStatWorkspaceFileQuery,
  useWorkspaceFilesQuery,
} from "@anyharness/sdk-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { twMerge } from "#product/primitives/utils/tw-merge";
import { FileTreeRow } from "#product/components/workspace/files/tree/FileTreeRow";
import { resolveWorkspaceStatPathKind } from "#product/lib/domain/files/path-references";
import { fileTreeIndentPaddingLeft } from "#product/lib/domain/files/file-tree-indent";
import {
  isRetryableFileTreeError,
  RETRY_FOLDER_LABEL,
  RETRY_ROOT_LABEL,
  type FileTreeController,
} from "#product/lib/domain/files/file-tree-query-failures";

interface FileTreeDirectoryProps {
  controller: FileTreeController;
  path: string;
  level: number;
}

export function FileTreeDirectory({ controller, path, level }: FileTreeDirectoryProps) {
  const { workspaceId } = controller;
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
  const retryable = failed && isRetryableFileTreeError(filesQuery.error);

  // Only virtualize the root level. Expanded directories remain inside their
  // root virtual item, whose dynamic height is measured after each async load.
  if (level === 0) {
    return (
      <div
        ref={scrollRef}
        role="tree"
        aria-label="Workspace files"
        aria-busy={loading || undefined}
        className="file-tree-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1"
      >
        {unavailable ? (
          <FileTreeStatus focusable message="Files are unavailable for this workspace." />
        ) : loading ? (
          <FileTreeStatus focusable message="Loading files…" />
        ) : retryable ? (
          <FileTreeRetryRow
            controller={controller}
            label={RETRY_ROOT_LABEL}
            rowKey={`${path}::retry`}
            path={path}
            level={level}
            refetch={filesQuery.refetch}
            busy={filesQuery.isFetching}
          />
        ) : failed ? (
          <FileTreeStatus focusable message="Files could not be loaded." tone="error" />
        ) : entries.length === 0 ? (
          <FileTreeStatus focusable message="This folder is empty." />
        ) : (
          <VirtualizedTree
            scrollRef={scrollRef}
            entries={entries}
            controller={controller}
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
      ) : retryable ? (
        <FileTreeRetryRow
          controller={controller}
          label={RETRY_FOLDER_LABEL}
          rowKey={`${path}::retry`}
          path={path}
          level={level}
          refetch={filesQuery.refetch}
          busy={filesQuery.isFetching}
        />
      ) : failed ? (
        <FileTreeStatus message="Folder unavailable" level={level} compact tone="error" />
      ) : entries.length === 0 ? (
        <FileTreeStatus message="Empty folder" level={level} compact />
      ) : entries.map((entry, index) => (
        <FileTreeEntryRow
          key={entry.path}
          entry={entry}
          controller={controller}
          level={level}
          posinset={index + 1}
          setsize={entries.length}
        />
      ))}
    </div>
  );
}

/**
 * The one roving retry treeitem a transient list failure renders. It is itself
 * the treeitem — never a status containing a nested button — so the tree keeps
 * exactly one tab stop.
 */
function FileTreeRetryRow({
  controller,
  label,
  rowKey,
  path,
  level,
  refetch,
  busy,
}: {
  controller: FileTreeController;
  label: string;
  rowKey: string;
  path: string;
  level: number;
  refetch: () => Promise<{ data?: { entries?: readonly WorkspaceFileEntry[] } }>;
  busy: boolean;
}) {
  const handleRetry = async () => {
    const token = controller.captureRequest();
    const ownedRoving = controller.isRoving(rowKey);
    const hadFocus = typeof document !== "undefined"
      && document.activeElement instanceof HTMLElement
      && document.activeElement.getAttribute("data-file-tree-row-key") === rowKey;
    const result = await refetch();
    if (!controller.isCurrent(token)) {
      return;
    }
    const children = result.data?.entries ?? [];
    // A repeated transient failure leaves the same retry row and roving
    // ownership in place; only a resolved listing moves the roving key, and
    // only while this row still owns it.
    if (children.length === 0 || !ownedRoving) {
      return;
    }
    const requested = children.find((entry) => entry.path === controller.selectedPath);
    controller.requestRowFocus((requested ?? children[0]!).path, { moveDom: hadFocus });
  };

  return (
    <FileTreeRow
      name={label}
      path={path}
      rowKey={rowKey}
      kind="retry"
      level={level}
      busy={busy}
      roving={controller.isRoving(rowKey)}
      posinset={1}
      setsize={1}
      onClick={() => void handleRetry()}
    />
  );
}

function VirtualizedTree({
  scrollRef,
  entries,
  controller,
  level,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  entries: readonly WorkspaceFileEntry[];
  controller: FileTreeController;
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

  const { selectedPath, onRootModel } = controller;
  useEffect(() => {
    onRootModel({
      rootKeys: entries.map((entry) => entry.path),
      scrollToRootIndex: (index) => virtualizer.scrollToIndex(index, { align: "auto" }),
    });
  }, [entries, onRootModel, virtualizer]);

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
              controller={controller}
              level={level}
              posinset={virtualItem.index + 1}
              setsize={entries.length}
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
  focusable = false,
}: {
  message: string;
  level?: number;
  compact?: boolean;
  tone?: "muted" | "error";
  focusable?: boolean;
}) {
  return (
    <p
      role="status"
      // With no rows at all, the status is the tree's sole tab stop.
      tabIndex={focusable ? 0 : undefined}
      className={twMerge(
        "flex items-center text-sidebar-row text-sidebar-muted-foreground outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-sidebar-ring",
        compact ? "h-7" : "px-1 py-3",
        tone === "error" && "text-destructive",
      )}
      style={compact ? { paddingLeft: fileTreeIndentPaddingLeft(level) } : undefined}
    >
      {message}
    </p>
  );
}

interface FileTreeEntryRowProps {
  entry: WorkspaceFileEntry;
  controller: FileTreeController;
  level: number;
  posinset: number;
  setsize: number;
}

function FileTreeEntryRow(props: FileTreeEntryRowProps) {
  if (props.entry.kind === "symlink") {
    return <SymlinkFileTreeEntryRow {...props} />;
  }
  return <ResolvedFileTreeEntryRow {...props} kind={props.entry.kind} />;
}

function SymlinkFileTreeEntryRow(props: FileTreeEntryRowProps) {
  const { entry, controller } = props;
  const shouldResolveSymlink = (
    controller.expandedPaths.has(entry.path)
    || controller.selectedPath.startsWith(`${entry.path}/`)
  );
  const symlinkStatQuery = useStatWorkspaceFileQuery({
    workspaceId: controller.workspaceId,
    path: entry.path,
    enabled: Boolean(controller.workspaceId && shouldResolveSymlink),
  });
  const [resolvedSymlinkKind, setResolvedSymlinkKind] = useState<"file" | "directory" | null>(
    null,
  );
  const [unavailable, setUnavailable] = useState(false);
  // The list row may stay `kind: "symlink"`, but stat describes the resolved
  // contained target: only `file`/`directory` are usable. An unexpected stat
  // `kind: "symlink"` is unavailable and is never inferred from `sizeBytes`.
  const symlinkTargetKind = resolveWorkspaceStatPathKind(symlinkStatQuery.data)
    ?? resolvedSymlinkKind;

  const handleEntryClick = async () => {
    let targetKind = symlinkTargetKind;
    if (!targetKind) {
      const token = controller.captureRequest();
      const result = await symlinkStatQuery.refetch();
      if (!controller.isCurrent(token)) {
        return;
      }
      targetKind = resolveWorkspaceStatPathKind(result.data);
      setResolvedSymlinkKind(targetKind);
      if (!targetKind) {
        setUnavailable(true);
        return;
      }
    }
    if (targetKind === "directory") {
      controller.toggleExpanded(entry.path);
    } else if (targetKind === "file") {
      controller.openFile(entry.path);
    }
  };

  const statSettledUnusable = Boolean(
    symlinkStatQuery.data && !resolveWorkspaceStatPathKind(symlinkStatQuery.data),
  );
  const isUnavailable = unavailable || statSettledUnusable
    || Boolean(symlinkStatQuery.error);

  return (
    <ResolvedFileTreeEntryRow
      {...props}
      kind={isUnavailable ? "unavailable" : symlinkTargetKind ?? "symlink"}
      disabled={isUnavailable}
      busy={symlinkStatQuery.isFetching}
      onClick={isUnavailable ? () => {} : () => void handleEntryClick()}
    />
  );
}

function ResolvedFileTreeEntryRow({
  entry,
  controller,
  level,
  posinset,
  setsize,
  kind,
  busy = false,
  disabled = false,
  onClick,
}: FileTreeEntryRowProps & {
  kind: "file" | "directory" | "symlink" | "unavailable";
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const isDirectory = kind === "directory";
  const expanded = isDirectory && controller.expandedPaths.has(entry.path);

  return (
    <div>
      <FileTreeRow
        name={entry.name}
        path={entry.path}
        kind={kind}
        level={level}
        selected={!isDirectory && entry.path === controller.selectedPath}
        expanded={isDirectory ? expanded : undefined}
        changed={controller.changedPaths?.has(entry.path)}
        busy={busy}
        disabled={disabled}
        roving={controller.isRoving(entry.path)}
        posinset={posinset}
        setsize={setsize}
        onClick={onClick ?? (() => {
          if (isDirectory) {
            controller.toggleExpanded(entry.path);
          } else {
            controller.openFile(entry.path);
          }
        })}
      />
      {isDirectory && expanded && (
        <FileTreeDirectory
          controller={controller}
          path={entry.path}
          level={level + 1}
        />
      )}
    </div>
  );
}
