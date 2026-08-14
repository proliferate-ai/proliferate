/** One item of the drag session that just dropped onto the webview, resolved
 * to an absolute local path. `size` is null for directories. */
export interface DroppedPathEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number | null;
}

/** A drag-pasteboard snapshot: the pasteboard change count it was read under
 * plus the resolved entries. The change count identifies the drag session —
 * compare against the count captured at drag-enter to bind the snapshot to
 * the drop being handled. */
export interface DroppedPathsSnapshot {
  changeCount: number;
  entries: DroppedPathEntry[];
}
