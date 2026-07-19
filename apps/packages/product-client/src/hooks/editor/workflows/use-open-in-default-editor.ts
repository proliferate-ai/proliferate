import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesktopFilesBridge,
  OpenTarget,
  PathKind,
} from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { resolvePreferredOpenTarget } from "#product/lib/domain/chat/composer/preference-resolvers";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { splitPathLineSuffix } from "#product/lib/domain/files/path-detection";

/**
 * Per-bridge cache so every chat message doesn't re-query the installed editor
 * list. The concrete Desktop bridge is stable for the host session.
 */
const cachedTargetsPromises = new WeakMap<
  DesktopFilesBridge,
  Map<PathKind, Promise<OpenTarget[]>>
>();
const EMPTY_OPEN_TARGETS: OpenTarget[] = [];

function loadTargets(files: DesktopFilesBridge, pathKind: PathKind): Promise<OpenTarget[]> {
  let targetsByKind = cachedTargetsPromises.get(files);
  if (!targetsByKind) {
    targetsByKind = new Map();
    cachedTargetsPromises.set(files, targetsByKind);
  }
  let targetsPromise = targetsByKind.get(pathKind);
  if (!targetsPromise) {
    targetsPromise = files.listOpenTargets(pathKind).catch(() => [] as OpenTarget[]);
    targetsByKind.set(pathKind, targetsPromise);
  }
  return targetsPromise;
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
 *    because Desktop open-target commands take a plain path.
 */
export function useOpenInDefaultEditor(pathKind: PathKind = "file"): UseOpenInDefaultEditorResult {
  const host = useProductHost();
  const files = host.desktop?.files ?? null;
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
    if (!files) {
      setTargets([]);
      return;
    }
    setTargets(null);
    void loadTargets(files, pathKind).then((loaded) => {
      if (!cancelled) setTargets(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [files, pathKind]);

  const openInDefaultEditor = useCallback(
    async (absolutePath: string) => {
      if (!files) {
        throw new Error("Local file access is not available.");
      }
      const list = targets ?? (await loadTargets(files, pathKind));
      const preferred = resolvePreferredOpenTarget(openableTargets(list), { defaultOpenInTargetId });
      if (!preferred) return;
      const { path } = splitPathLineSuffix(absolutePath);
      await files.openTarget(preferred.id, path).catch(() => {});
    },
    [files, pathKind, targets, defaultOpenInTargetId],
  );

  const copyPath = useCallback(async (path: string) => {
    await host.clipboard.writeText(path);
  }, [host.clipboard]);

  const openTarget = useCallback(async (targetId: string, absolutePath: string) => {
    if (!files) {
      throw new Error("Local file access is not available.");
    }
    const { path } = splitPathLineSuffix(absolutePath);
    await files.openTarget(targetId, path).catch(() => {});
  }, [files]);

  const revealInFinder = useCallback(async (absolutePath: string) => {
    if (!files) {
      throw new Error("Local file access is not available.");
    }
    const { path } = splitPathLineSuffix(absolutePath);
    await files.openTarget("finder", path).catch(() => {});
  }, [files]);

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
