import { useCallback, useEffect, useMemo, useState } from "react";
import {
  copyPath as copyPathToClipboard,
  listOpenTargets,
  openTarget as execOpenTarget,
  type OpenTarget,
} from "@/lib/access/tauri/shell";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/composer/preference-resolvers";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { splitPathLineSuffix } from "@/lib/domain/files/path-detection";

/**
 * Module-level cache so every chat message doesn't re-query the editor list.
 * `listOpenTargets()` is a Tauri call that enumerates installed editors;
 * the result is stable for the session.
 */
let cachedTargetsPromise: Promise<OpenTarget[]> | null = null;
const EMPTY_OPEN_TARGETS: OpenTarget[] = [];

function loadFileTargets(): Promise<OpenTarget[]> {
  if (!cachedTargetsPromise) {
    cachedTargetsPromise = listOpenTargets("file").catch(() => [] as OpenTarget[]);
  }
  return cachedTargetsPromise;
}

interface UseOpenInDefaultEditorResult {
  /** Open a path in the user's preferred external editor. */
  openInDefaultEditor: (absolutePath: string) => Promise<void>;
  /** Open a path in a specific shell target. */
  openTarget: (targetId: string, absolutePath: string) => Promise<void>;
  /** Reveal a path in Finder. */
  revealInFinder: (absolutePath: string) => Promise<void>;
  /** Copy a path string to the clipboard. */
  copyPath: (path: string) => Promise<void>;
  /** Available non-Proliferate shell targets for this path kind. */
  targets: OpenTarget[];
  /** Resolved target used by "open in default" for display and primary action. */
  defaultTarget: OpenTarget | null;
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
 *  - Falls back through the product default target, Finder, then the first
 *    available target (matches `resolvePreferredOpenTarget` semantics).
 *  - Strips any `:line[:col]` suffix before invoking the shell command,
 *    because the underlying Tauri commands take a plain path.
 */
export function useOpenInDefaultEditor(): UseOpenInDefaultEditorResult {
  const [targets, setTargets] = useState<OpenTarget[] | null>(null);
  const defaultOpenInTargetId = useUserPreferencesStore(
    (state) => state.defaultOpenInTargetId,
  );
  const availableTargets = targets ?? EMPTY_OPEN_TARGETS;
  const defaultTarget = useMemo(
    () => resolvePreferredOpenTarget(openableTargets(availableTargets), { defaultOpenInTargetId }),
    [availableTargets, defaultOpenInTargetId],
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
      const preferred = resolvePreferredOpenTarget(openableTargets(list), { defaultOpenInTargetId });
      if (!preferred) return;
      const { path } = splitPathLineSuffix(absolutePath);
      await execOpenTarget(preferred.id, path).catch(() => {});
    },
    [targets, defaultOpenInTargetId],
  );

  const copyPath = useCallback(async (path: string) => {
    await copyPathToClipboard(path);
  }, []);

  const openTarget = useCallback(async (targetId: string, absolutePath: string) => {
    const { path } = splitPathLineSuffix(absolutePath);
    await execOpenTarget(targetId, path).catch(() => {});
  }, []);

  const revealInFinder = useCallback(async (absolutePath: string) => {
    const { path } = splitPathLineSuffix(absolutePath);
    await execOpenTarget("finder", path).catch(() => {});
  }, []);

  return {
    openInDefaultEditor,
    openTarget,
    revealInFinder,
    copyPath,
    targets: availableTargets,
    defaultTarget,
    ready: targets !== null,
  };
}

function openableTargets(targets: readonly OpenTarget[]): OpenTarget[] {
  return targets.filter((target) => target.kind !== "copy");
}
