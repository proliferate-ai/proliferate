import type { WorkspaceFileEntry } from "@anyharness/sdk";
import { FileTreeRow } from "#product/components/workspace/files/tree/FileTreeRow";
import type { FileTreeController } from "#product/lib/domain/files/file-tree-query-failures";

/**
 * The one roving retry treeitem a transient list failure renders. It is itself
 * the treeitem — never a status containing a nested button — so the tree keeps
 * exactly one tab stop.
 *
 * Extracted out of `FileTreeDirectory.tsx` as pure code motion to keep both
 * files under the repo's line cap; no behavior change.
 */
export function FileTreeRetryRow({
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
    const result = await refetch();
    if (!controller.isCurrent(token)) {
      return;
    }
    // Re-evaluate focus at settlement, not at dispatch time: the user may
    // have moved focus to the filter or another row while the refetch was
    // in flight, and DOM focus must never be stolen back from them.
    const hasFocus = typeof document !== "undefined"
      && document.activeElement instanceof HTMLElement
      && document.activeElement.getAttribute("data-file-tree-row-key") === rowKey;
    const children = result.data?.entries ?? [];
    // A repeated transient failure leaves the same retry row and roving
    // ownership in place; only a resolved listing moves the roving key, and
    // only while this row still owns it.
    if (children.length === 0 || !ownedRoving) {
      return;
    }
    const requested = children.find((entry) => entry.path === controller.selectedPath);
    controller.requestRowFocus((requested ?? children[0]!).path, { moveDom: hasFocus });
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
