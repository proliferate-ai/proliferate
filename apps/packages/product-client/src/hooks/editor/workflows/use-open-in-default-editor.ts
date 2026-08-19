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
    targetsPromise = files.listOpenTargets(pathKind);
    targetsByKind.set(pathKind, targetsPromise);
    void targetsPromise.catch(() => {
      if (targetsByKind.get(pathKind) === targetsPromise) {
        targetsByKind.delete(pathKind);
      }
    });
  }
  return targetsPromise;
}

interface UseOpenInDefaultEditorResult {
  /** Open a path in the preferred external target and report whether it launched. */
  openInDefaultEditor: (
    absolutePath: string,
    imperativePathKind: PathKind,
  ) => Promise<boolean>;
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
interface LoadedTargets {
  files: DesktopFilesBridge | null;
  pathKind: PathKind;
  targets: OpenTarget[];
}

export function useOpenInDefaultEditor(
  pathKind: PathKind | null,
): UseOpenInDefaultEditorResult {
  const host = useProductHost();
  const files = host.desktop?.files ?? null;
  const [loadedTargets, setLoadedTargets] = useState<LoadedTargets | null>(null);
  const defaultOpenInTargetId = useUserPreferencesStore(
    (state) => state.defaultOpenInTargetId,
  );
  const targets = pathKind !== null
    && loadedTargets?.files === files
    && loadedTargets.pathKind === pathKind
    ? loadedTargets.targets
    : null;
  const availableTargets = targets ?? EMPTY_OPEN_TARGETS;
  const defaultTarget = useMemo(
    () => resolvePreferredOpenTarget(openableTargets(availableTargets), { defaultOpenInTargetId }),
    [availableTargets, defaultOpenInTargetId],
  );

  useEffect(() => {
    let cancelled = false;
    if (pathKind === null) {
      setLoadedTargets(null);
      return;
    }
    if (!files) {
      setLoadedTargets({ files, pathKind, targets: [] });
      return;
    }
    setLoadedTargets((current) => (
      current?.files === files && current.pathKind === pathKind ? current : null
    ));
    void loadTargets(files, pathKind).then(
      (loaded) => {
        if (!cancelled) setLoadedTargets({ files, pathKind, targets: loaded });
      },
      () => {
        // Keep the unresolved state so an explicit open action retries target
        // discovery instead of treating a transient bridge failure as an
        // authoritative empty target list.
        if (!cancelled) setLoadedTargets(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [files, pathKind]);

  const openInDefaultEditor = useCallback(
    async (absolutePath: string, imperativePathKind: PathKind) => {
      if (!files) {
        throw new Error("Local file access is not available.");
      }
      let list = loadedTargets?.files === files
        && loadedTargets.pathKind === imperativePathKind
        ? loadedTargets.targets
        : null;
      if (list === null) {
        try {
          list = await loadTargets(files, imperativePathKind);
          setLoadedTargets({ files, pathKind: imperativePathKind, targets: list });
        } catch {
          return false;
        }
      }
      const preferred = resolvePreferredOpenTarget(openableTargets(list), { defaultOpenInTargetId });
      if (!preferred) return false;
      const { path } = splitPathLineSuffix(absolutePath);
      try {
        await files.openTarget(preferred.id, path);
        return true;
      } catch {
        return false;
      }
    },
    [files, loadedTargets, defaultOpenInTargetId],
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
    ready: pathKind !== null && targets !== null,
  };
}

function openableTargets(targets: readonly OpenTarget[]): OpenTarget[] {
  return targets.filter((target) => target.kind !== "copy");
}
