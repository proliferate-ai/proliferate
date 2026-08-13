import { invoke } from "@tauri-apps/api/core";
import type { DroppedPathEntry } from "@proliferate/product-client/host/desktop-bridge";

/**
 * Absolute paths for the drag session that just dropped onto the webview,
 * read from the macOS drag pasteboard. Empty on failure or when the drag
 * carried no file paths, so callers fall back to byte-based File handling.
 */
export async function readDragDropPaths(): Promise<DroppedPathEntry[]> {
  try {
    return await invoke<DroppedPathEntry[]>("read_drag_drop_paths");
  } catch {
    return [];
  }
}
