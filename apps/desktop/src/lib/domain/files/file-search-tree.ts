export interface FileSearchMatch {
  name: string;
  path: string;
}

export interface FileSearchTreeDirectory {
  kind: "directory";
  /** Full workspace-relative directory path ("" for workspace root). */
  path: string;
  /** Compressed display label, e.g. "components/landing". */
  label: string;
  files: FileSearchMatch[];
}

/**
 * Groups flat file-search matches into directory groups, Codex-style:
 * one row per parent directory (chains of single-child directories are
 * collapsed into a single compressed label), with matched files nested
 * under it. Root-level matches are grouped under a "" directory.
 */
export function buildFileSearchTree(
  matches: readonly FileSearchMatch[],
): FileSearchTreeDirectory[] {
  const byDirectory = new Map<string, FileSearchMatch[]>();
  const order: string[] = [];

  for (const match of matches) {
    const directory = parentDirectoryPath(match.path);
    let bucket = byDirectory.get(directory);
    if (!bucket) {
      bucket = [];
      byDirectory.set(directory, bucket);
      order.push(directory);
    }
    bucket.push(match);
  }

  return order.map((directory) => ({
    kind: "directory",
    path: directory,
    label: directory === "" ? "/" : directory,
    files: byDirectory.get(directory)!,
  }));
}

const SEGMENT_MAX = 14;
const KEEP_FULL_EDGES = 1;

/**
 * Middle-truncates each interior path segment of a long directory label,
 * Codex-style: "docs/processes/legal/troubleshooting-notes" becomes
 * "docs/proc…/le…/troubleshooting-notes" — first and last segments stay
 * readable, interior segments are shortened.
 */
export function truncatePathLabel(label: string, maxLength = 42): string {
  if (label.length <= maxLength) {
    return label;
  }
  const segments = label.split("/");
  if (segments.length <= 2) {
    return label;
  }
  const truncated = segments.map((segment, index) => {
    const isEdge = index < KEEP_FULL_EDGES || index >= segments.length - KEEP_FULL_EDGES;
    if (isEdge || segment.length <= SEGMENT_MAX) {
      return segment;
    }
    return `${segment.slice(0, Math.max(2, Math.floor(SEGMENT_MAX / 2)))}…`;
  });
  return truncated.join("/");
}

function parentDirectoryPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}
