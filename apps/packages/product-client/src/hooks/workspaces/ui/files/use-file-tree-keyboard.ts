import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

/** Attributes every roving row publishes so the controller can read the tree. */
export const FILE_TREE_ROW_KEY_ATTRIBUTE = "data-file-tree-row-key";
export const FILE_TREE_ROW_LABEL_ATTRIBUTE = "data-file-tree-row-label";
export const FILE_TREE_ROW_PATH_ATTRIBUTE = "data-file-tree-row-path";

/** Printable typeahead prefix lifetime. */
const TYPEAHEAD_WINDOW_MS = 700;

/**
 * Sentinels for a focus request that names a position rather than a row.
 * Neither spelling can occur as a canonical runtime-relative path, so a
 * sentinel never collides with a real row key.
 */
export const FILE_TREE_FIRST_ROW = "__file-tree-first-row__";
export const FILE_TREE_LAST_ROW = "__file-tree-last-row__";

export interface FileTreeRootBoundary {
  /** Every root-level row key in visible order, including unmounted ones. */
  rootKeys: readonly string[];
  /** Ask the root virtualizer to bring that index into the mounted window. */
  scrollToRootIndex: (index: number) => void;
}

export interface FileTreeKeyboardController {
  treeRef: RefObject<HTMLDivElement | null>;
  rovingKey: string | null;
  isRoving: (key: string) => boolean;
  setRovingKey: (key: string | null) => void;
  /**
   * Adopt `preferredKey` when it is visible, else the first visible row. Used
   * for first materialization and after a filter/collapse/query change removes
   * the current roving row.
   */
  reconcileRoving: (preferredKey: string | null) => void;
  /**
   * Take roving ownership of `key` and, when `moveDom` is set, focus it once it
   * mounts. A virtualized root row is scrolled into the window first.
   */
  requestRowFocus: (key: string, options?: { moveDom?: boolean }) => void;
  handleTreeKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * The single roving/typeahead tree controller spanning the lazy hierarchy and
 * the filtered results tree.
 *
 * It reads visible order from the DOM (`[role="treeitem"]` inside the tree
 * container) rather than a second mirrored model, so virtualized root rows,
 * lazily loaded children, filtered results, and the retry treeitem all
 * participate through the same ordering without any of them duplicating the
 * hierarchy. Positions the virtualizer has not mounted yet are reached through
 * {@link FileTreeRootBoundary}: the controller scrolls the root index into the
 * window, holds a pending focus request, and resolves it when the row mounts —
 * a request never fails merely because the node was unmounted.
 */
export function useFileTreeKeyboard({
  boundary,
  onExpand,
  onCollapse,
}: {
  boundary: FileTreeRootBoundary;
  onExpand: (path: string) => void;
  onCollapse: (path: string) => void;
}): FileTreeKeyboardController {
  const treeRef = useRef<HTMLDivElement | null>(null);
  const [rovingKey, setRovingKeyState] = useState<string | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const typeaheadRef = useRef<{ prefix: string; at: number }>({ prefix: "", at: 0 });
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;

  const rows = useCallback((): HTMLElement[] => {
    const root = treeRef.current;
    if (!root) {
      return [];
    }
    return Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  }, []);

  const rowKeyOf = useCallback(
    (element: HTMLElement) => element.getAttribute(FILE_TREE_ROW_KEY_ATTRIBUTE) ?? "",
    [],
  );

  const resolvePendingFocus = useCallback(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) {
      return;
    }
    const visible = rows();
    if (visible.length === 0) {
      return;
    }
    const target = pending === FILE_TREE_FIRST_ROW
      ? visible[0]
      : pending === FILE_TREE_LAST_ROW
        ? visible[visible.length - 1]
        : visible.find((element) => rowKeyOf(element) === pending);
    if (!target) {
      return;
    }
    pendingFocusRef.current = null;
    setRovingKeyState(rowKeyOf(target));
    target.focus();
  }, [rowKeyOf, rows]);

  // A pending request may become resolvable through a React commit or through
  // the virtualizer's own DOM writes, so watch both.
  useEffect(() => {
    resolvePendingFocus();
  });

  useEffect(() => {
    const root = treeRef.current;
    if (!root || typeof MutationObserver === "undefined") {
      return;
    }
    const observer = new MutationObserver(() => resolvePendingFocus());
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [resolvePendingFocus]);

  const setRovingKey = useCallback((key: string | null) => {
    setRovingKeyState(key);
  }, []);

  const reconcileRoving = useCallback((preferredKey: string | null) => {
    const visible = rows();
    if (visible.length === 0) {
      return;
    }
    const preferred = preferredKey === null
      ? undefined
      : visible.find((element) => rowKeyOf(element) === preferredKey);
    setRovingKeyState(rowKeyOf(preferred ?? visible[0]!));
  }, [rowKeyOf, rows]);

  const requestRowFocus = useCallback(
    (key: string, options?: { moveDom?: boolean }) => {
      const visible = rows();
      const mounted = key === FILE_TREE_FIRST_ROW
        ? visible[0]
        : key === FILE_TREE_LAST_ROW
          ? visible[visible.length - 1]
          : visible.find((element) => rowKeyOf(element) === key);
      if (mounted && (key !== FILE_TREE_LAST_ROW || isLastRootMounted(boundaryRef.current, visible, rowKeyOf))) {
        setRovingKeyState(rowKeyOf(mounted));
        if (options?.moveDom) {
          mounted.focus();
        }
        return;
      }
      // Not mounted: ask the root virtualizer for the index and hold the
      // request until the row commits.
      const { rootKeys, scrollToRootIndex } = boundaryRef.current;
      const index = key === FILE_TREE_FIRST_ROW
        ? 0
        : key === FILE_TREE_LAST_ROW
          ? rootKeys.length - 1
          : rootKeys.indexOf(rootAncestorKey(key));
      if (index >= 0) {
        scrollToRootIndex(index);
      }
      if (options?.moveDom) {
        pendingFocusRef.current = key;
      } else {
        setRovingKeyState(key);
      }
    },
    [rowKeyOf, rows],
  );

  const moveTo = useCallback((element: HTMLElement | undefined) => {
    if (!element) {
      return;
    }
    setRovingKeyState(element.getAttribute(FILE_TREE_ROW_KEY_ATTRIBUTE) ?? "");
    element.focus();
  }, []);

  const handleTreeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const visible = rows();
      if (visible.length === 0) {
        return;
      }
      const currentIndex = visible.findIndex(
        (element) => rowKeyOf(element) === rovingKey,
      );
      const current = visible[currentIndex];
      const level = current ? Number(current.getAttribute("aria-level") ?? "1") : 1;
      const expanded = current?.getAttribute("aria-expanded") ?? null;
      const path = current?.getAttribute(FILE_TREE_ROW_PATH_ATTRIBUTE) ?? "";

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          if (currentIndex < visible.length - 1) {
            moveTo(visible[currentIndex + 1]);
            return;
          }
          crossRootBoundary(boundaryRef.current, visible, rowKeyOf, 1, requestRowFocus);
          return;
        }
        case "ArrowUp": {
          event.preventDefault();
          if (currentIndex > 0) {
            moveTo(visible[currentIndex - 1]);
            return;
          }
          crossRootBoundary(boundaryRef.current, visible, rowKeyOf, -1, requestRowFocus);
          return;
        }
        case "Home": {
          event.preventDefault();
          requestRowFocus(FILE_TREE_FIRST_ROW, { moveDom: true });
          return;
        }
        case "End": {
          event.preventDefault();
          requestRowFocus(FILE_TREE_LAST_ROW, { moveDom: true });
          return;
        }
        case "ArrowRight": {
          event.preventDefault();
          if (expanded === "false") {
            onExpand(path);
            return;
          }
          if (expanded === "true") {
            const next = visible[currentIndex + 1];
            // While children are still loading there is no deeper row yet, so
            // focus deliberately stays on the directory.
            if (next && Number(next.getAttribute("aria-level") ?? "1") > level) {
              moveTo(next);
            }
          }
          return;
        }
        case "ArrowLeft": {
          event.preventDefault();
          if (expanded === "true") {
            onCollapse(path);
            return;
          }
          for (let index = currentIndex - 1; index >= 0; index -= 1) {
            const candidate = visible[index]!;
            if (Number(candidate.getAttribute("aria-level") ?? "1") < level) {
              moveTo(candidate);
              return;
            }
          }
          return;
        }
        case "Enter":
        case " ": {
          if (!current) {
            return;
          }
          // preventDefault suppresses the button's own synthesized click so a
          // row is activated exactly once.
          event.preventDefault();
          current.click();
          return;
        }
        default:
          break;
      }

      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const now = Date.now();
      const state = typeaheadRef.current;
      const prefix = now - state.at > TYPEAHEAD_WINDOW_MS
        ? event.key.toLowerCase()
        : state.prefix + event.key.toLowerCase();
      typeaheadRef.current = { prefix, at: now };
      const match = findTypeaheadMatch(visible, currentIndex, prefix);
      if (match) {
        event.preventDefault();
        moveTo(match);
      }
    },
    [moveTo, onCollapse, onExpand, requestRowFocus, rovingKey, rowKeyOf, rows],
  );

  const isRoving = useCallback((key: string) => key === rovingKey, [rovingKey]);

  return {
    treeRef,
    rovingKey,
    isRoving,
    setRovingKey,
    reconcileRoving,
    requestRowFocus,
    handleTreeKeyDown,
  };
}

/** A nested row's root-level ancestor key is its first path segment. */
function rootAncestorKey(key: string): string {
  const separator = key.indexOf("/");
  return separator === -1 ? key : key.slice(0, separator);
}

function isLastRootMounted(
  boundary: FileTreeRootBoundary,
  visible: readonly HTMLElement[],
  rowKeyOf: (element: HTMLElement) => string,
): boolean {
  const lastRootKey = boundary.rootKeys[boundary.rootKeys.length - 1];
  if (lastRootKey === undefined) {
    return true;
  }
  return visible.some((element) => rootAncestorKey(rowKeyOf(element)) === lastRootKey);
}

/**
 * ArrowDown past the last mounted row (or ArrowUp before the first) at a root
 * virtual boundary: scroll the neighbouring root index in and focus it once it
 * mounts.
 */
function crossRootBoundary(
  boundary: FileTreeRootBoundary,
  visible: readonly HTMLElement[],
  rowKeyOf: (element: HTMLElement) => string,
  direction: 1 | -1,
  requestRowFocus: (key: string, options?: { moveDom?: boolean }) => void,
): void {
  const edge = direction === 1 ? visible[visible.length - 1] : visible[0];
  if (!edge) {
    return;
  }
  const edgeRoot = rootAncestorKey(rowKeyOf(edge));
  const index = boundary.rootKeys.indexOf(edgeRoot);
  const nextIndex = index + direction;
  const nextKey = boundary.rootKeys[nextIndex];
  if (index < 0 || nextKey === undefined) {
    return;
  }
  requestRowFocus(nextKey, { moveDom: true });
}

function findTypeaheadMatch(
  visible: readonly HTMLElement[],
  currentIndex: number,
  prefix: string,
): HTMLElement | undefined {
  const start = currentIndex < 0 ? 0 : currentIndex;
  for (let offset = 1; offset <= visible.length; offset += 1) {
    const candidate = visible[(start + offset) % visible.length]!;
    const label = (
      candidate.getAttribute(FILE_TREE_ROW_LABEL_ATTRIBUTE) ?? ""
    ).toLowerCase();
    if (label.startsWith(prefix)) {
      return candidate;
    }
  }
  return undefined;
}
