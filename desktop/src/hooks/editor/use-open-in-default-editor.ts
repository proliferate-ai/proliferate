import { useCallback, useEffect, useState } from "react";
import {
  copyPath as copyPathToClipboard,
  listOpenTargets,
  openTarget as execOpenTarget,
  type OpenTarget,
} from "@/platform/tauri/shell";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/preference-resolvers";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { splitPathLineSuffix } from "@/lib/domain/files/path-detection";

/**
 * Module-level cache so every chat message doesn't re-query the editor list.
 * `listOpenTargets()` is a Tauri call that enumerates installed editors;
 * the result is stable for the session.
 */
let cachedTargetsPromise: Promise<OpenTarget[]> | null = null;

function loadFileTargets(): Promise<OpenTarget[]> {
  if (!cachedTargetsPromise) {
    cachedTargetsPromise = listOpenTargets("file").catch(() => [] as OpenTarget[]);
  }
  return cachedTargetsPromise;
}

interface UseOpenInDefaultEditorResult {
  /** Open a path in the user's preferred external editor. */
  openInDefaultEditor: (absolutePath: string) => Promise<void>;
  /** Copy a path string to the clipboard. */
  copyPath: (path: string) => Promise<void>;
  /** Whether the editor target list has loaded. */
  ready: boolean;
}

/**
 * Single entry point for "open this file in the user's configured default
 * editor." Used by markdown file links and tool-call file chips so they share
 * one behavior.
 *
 * Resolution rules:
 *  - Reads `defaultOpenInTargetId` from user preferences.
 *  - Falls back to the first detected editor target, then to the first target
 *    of any kind (matches existing `resolvePreferredOpenTarget` semantics).
 *  - Strips any `:line[:col]` suffix before invoking the shell command,
 *    because the underlying Tauri commands take a plain path.
 */
export function useOpenInDefaultEditor(): UseOpenInDefaultEditorResult {
  const [targets, setTargets] = useState<OpenTarget[] | null>(null);
  const defaultOpenInTargetId = useUserPreferencesStore(
    (state) => state.defaultOpenInTargetId,
  );

  useEffect(() => {
    let cancelled = false;
    void loadFileTargets().then((loaded) => {
      if (!cancelled) setTargets(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openInDefaultEditor = useCallback(
    async (absolutePath: string) => {
      const list = targets ?? (await loadFileTargets());
      const preferred = resolvePreferredOpenTarget(list, { defaultOpenInTargetId });
      if (!preferred) return;
      const { path } = splitPathLineSuffix(absolutePath);
      await execOpenTarget(preferred.id, path).catch(() => {});
    },
    [targets, defaultOpenInTargetId],
  );

  const copyPath = useCallback(async (path: string) => {
    await copyPathToClipboard(path);
  }, []);

  return {
    openInDefaultEditor,
    copyPath,
    ready: targets !== null,
  };
}
