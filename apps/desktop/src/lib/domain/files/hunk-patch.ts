/**
 * Reconstructs a valid single-hunk unified diff patch from a raw patch string
 * and a hunk index. The result can be sent to `git apply` as-is.
 *
 * Returns `null` if the hunk cannot be extracted (binary, rename/copy, out-of-range index).
 */

const HUNK_RANGE_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export interface HunkPatchOptions {
  /** The full patch text as returned by the diff endpoint */
  patch: string;
  /** 0-based index of the hunk to extract */
  hunkIndex: number;
  /** File path (new side) for the diff header */
  filePath: string;
  /** Old path (for renames); when set the hunk is NOT extractable */
  oldPath?: string | null;
}

export interface HunkPatchResult {
  /** A complete unified diff patch containing only the selected hunk */
  patch: string;
}

/**
 * Returns true if the file's patch is eligible for hunk-level actions.
 * Binary, rename/copy, and truncated patches are excluded.
 */
export function isHunkActionEligible(patch: string, oldPath?: string | null): boolean {
  if (!patch || patch.trim().length === 0) return false;
  if (oldPath) return false; // rename/copy — hide pill
  if (patch.includes("GIT binary patch") || patch.includes("Binary files ")) return false;
  if (patch.includes("rename from ") || patch.includes("rename to ")) return false;
  if (patch.includes("copy from ") || patch.includes("copy to ")) return false;
  return true;
}

/**
 * Extract the Nth hunk from a unified diff patch and wrap it in valid file headers.
 */
export function extractHunkPatch(options: HunkPatchOptions): HunkPatchResult | null {
  const { patch, hunkIndex, filePath, oldPath } = options;

  if (!isHunkActionEligible(patch, oldPath)) return null;

  const lines = patch.split("\n");

  // Collect file-level headers and split into hunks
  const fileHeaders: string[] = [];
  const hunkStarts: number[] = []; // line indices where @@ starts

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("@@")) {
      hunkStarts.push(i);
    } else if (hunkStarts.length === 0) {
      // Everything before the first @@ is file-level header
      fileHeaders.push(line);
    }
  }

  if (hunkIndex < 0 || hunkIndex >= hunkStarts.length) return null;

  // Determine hunk body range
  const start = hunkStarts[hunkIndex];
  const end = hunkIndex + 1 < hunkStarts.length ? hunkStarts[hunkIndex + 1] : lines.length;

  // Collect hunk lines (the @@ line + body)
  let hunkLines = lines.slice(start, end);

  // Trim trailing empty lines (artifact of split)
  while (hunkLines.length > 0 && hunkLines[hunkLines.length - 1] === "") {
    hunkLines = hunkLines.slice(0, -1);
  }

  if (hunkLines.length === 0) return null;

  // Build file headers if not present (for patches that arrive without them)
  let headers: string[];
  if (fileHeaders.length > 0 && fileHeaders.some((h) => h.startsWith("diff --git"))) {
    headers = fileHeaders;
  } else {
    // Detect new/deleted file from the @@ range
    const rangeMatch = HUNK_RANGE_RE.exec(hunkLines[0]);
    const oldCount = rangeMatch ? parseInt(rangeMatch[2] ?? "1", 10) : 1;
    const newCount = rangeMatch ? parseInt(rangeMatch[4] ?? "1", 10) : 1;

    headers = [`diff --git a/${filePath} b/${filePath}`];

    if (oldCount === 0 && isNewFileHunk(hunkLines)) {
      // New file
      headers.push("new file mode 100644");
      headers.push("--- /dev/null");
      headers.push(`+++ b/${filePath}`);
    } else if (newCount === 0 && isDeletedFileHunk(hunkLines)) {
      // Deleted file
      headers.push("deleted file mode 100644");
      headers.push(`--- a/${filePath}`);
      headers.push("+++ /dev/null");
    } else {
      headers.push(`--- a/${filePath}`);
      headers.push(`+++ b/${filePath}`);
    }
  }

  const result = [...headers, ...hunkLines].join("\n");

  // Ensure trailing newline
  const finalPatch = result.endsWith("\n") ? result : result + "\n";

  return { patch: finalPatch };
}

function isNewFileHunk(hunkLines: string[]): boolean {
  // All non-header lines should be additions or "\ No newline" markers
  for (let i = 1; i < hunkLines.length; i++) {
    const line = hunkLines[i];
    if (line.startsWith("+")) continue;
    if (line.startsWith("\\ ")) continue;
    if (line === "") continue;
    return false; // has context or removal lines — not purely new
  }
  return true;
}

function isDeletedFileHunk(hunkLines: string[]): boolean {
  // All non-header lines should be removals or "\ No newline" markers
  for (let i = 1; i < hunkLines.length; i++) {
    const line = hunkLines[i];
    if (line.startsWith("-")) continue;
    if (line.startsWith("\\ ")) continue;
    if (line === "") continue;
    return false;
  }
  return true;
}
