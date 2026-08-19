/**
 * Ownership-local support split for the docked tree (spec "02A - Docked File
 * Tree", `02A-PF-L01`): the shared controller seam and the retryable/terminal
 * failure classification both trees read. Behaviour lives with its callers;
 * only the declarations moved here to keep the owning components under their
 * size ratchet.
 */

/** Retry treeitem labels are pinned copy, never derived from a backend message. */
export const RETRY_ROOT_LABEL = "Retry loading files";
export const RETRY_FOLDER_LABEL = "Retry folder";

/**
 * Typed file-authority/path/refusal codes. They are terminal regardless of the
 * transport shape: the row exposes no retry action and never refetches on
 * activation.
 */
const TERMINAL_FILE_ERROR_CODES = new Set([
  "FILE_NOT_FOUND",
  "FILE_PERMISSION_DENIED",
  "INVALID_FILE_PATH",
  "PATH_OUTSIDE_WORKSPACE",
  "NOT_A_DIRECTORY",
]);

function readErrorField(error: unknown, field: string): unknown {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const direct = (error as Record<string, unknown>)[field];
  if (direct !== undefined) {
    return direct;
  }
  const problem = (error as { problem?: unknown }).problem;
  if (typeof problem !== "object" || problem === null) {
    return undefined;
  }
  return (problem as Record<string, unknown>)[field];
}

/**
 * Retryable means a transport failure with no HTTP status, or an HTTP status at
 * or above 500. Every typed authority/path/refusal code and every other HTTP
 * 4xx is terminal.
 */
export function isRetryableFileTreeError(error: unknown): boolean {
  const code = readErrorField(error, "code");
  if (typeof code === "string" && TERMINAL_FILE_ERROR_CODES.has(code)) {
    return false;
  }
  const status = readErrorField(error, "status");
  if (typeof status !== "number") {
    return true;
  }
  return status >= 500;
}

/**
 * The controller seam every tree row talks to. `FileEditorView` is the single
 * dock controller: it owns the canonical `openFile` action, the synchronous
 * expansion scope, roving ownership, and the async revision token every
 * post-await mutation is checked against. No row re-derives availability,
 * performs fuzzy recovery, or discovers a native target.
 */
export interface FileTreeController {
  workspaceId: string | null;
  selectedPath: string;
  changedPaths?: Set<string>;
  expandedPaths: ReadonlySet<string>;
  setExpanded: (path: string, expanded: boolean) => void;
  toggleExpanded: (path: string) => void;
  openFile: (path: string) => void;
  isRoving: (key: string) => boolean;
  requestRowFocus: (key: string, options?: { moveDom?: boolean }) => void;
  captureRequest: () => number;
  isCurrent: (token: number) => boolean;
  onRootModel: (model: {
    rootKeys: readonly string[];
    scrollToRootIndex: (index: number) => void;
  }) => void;
}
