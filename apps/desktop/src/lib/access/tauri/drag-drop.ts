import { invoke } from "@tauri-apps/api/core";
import type { DroppedPathsSnapshot } from "@proliferate/product-client/host/desktop-file-drop-bridge";

/**
 * The drag pasteboard's current change count; identifies the drag session
 * currently over the webview. -1 on failure, matching the no-pasteboard
 * platform value so callers skip correlation rather than reject drops.
 */
export async function getDragPasteboardChangeCount(): Promise<number> {
  try {
    return await invoke<number>("drag_pasteboard_change_count");
  } catch {
    return -1;
  }
}

/**
 * Absolute paths for the drag session that just dropped onto the webview,
 * read from the macOS drag pasteboard with the change count of the read.
 * Empty entries on failure or when the drag carried no file paths, so
 * callers fall back to byte-based File handling.
 */
export async function readDragDropPaths(): Promise<DroppedPathsSnapshot> {
  try {
    return await invoke<DroppedPathsSnapshot>("read_drag_drop_paths");
  } catch {
    return { changeCount: -1, entries: [] };
  }
}
