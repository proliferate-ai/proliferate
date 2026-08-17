import { useCallback, useEffect, useState } from "react";
import type { DesktopFilesBridge } from "@proliferate/product-client/host/desktop-bridge";
import { isHomeRelativeFileReference } from "#product/lib/domain/files/path-references";

const cachedHomeDirectoryPromises = new WeakMap<DesktopFilesBridge, Promise<string>>();

function loadHomeDirectory(files: DesktopFilesBridge): Promise<string> {
  let promise = cachedHomeDirectoryPromises.get(files);
  if (!promise) {
    promise = files.getHomeDirectory().then((path) => {
      const trimmed = path.trim();
      if (!trimmed) {
        throw new Error("Desktop home directory is unavailable.");
      }
      return trimmed;
    });
    cachedHomeDirectoryPromises.set(files, promise);
    void promise.catch(() => {
      if (cachedHomeDirectoryPromises.get(files) === promise) {
        cachedHomeDirectoryPromises.delete(files);
      }
    });
  }
  return promise;
}

export function useHomeRelativeFileReference(
  files: DesktopFilesBridge | null,
  rawPath: string,
) {
  const needsHomeDirectory = isHomeRelativeFileReference(rawPath);
  const [homeDirectory, setHomeDirectory] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!needsHomeDirectory || !files) {
      setHomeDirectory(null);
      setPending(false);
      return;
    }

    setHomeDirectory(null);
    setPending(true);
    void loadHomeDirectory(files).then(
      (path) => {
        if (!cancelled) setHomeDirectory(path);
      },
      () => {
        if (!cancelled) setHomeDirectory(null);
      },
    ).finally(() => {
      if (!cancelled) setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [files, needsHomeDirectory]);

  const resolveHomeDirectory = useCallback(async () => {
    if (!needsHomeDirectory || !files) {
      return null;
    }
    if (homeDirectory) {
      return homeDirectory;
    }
    try {
      const path = await loadHomeDirectory(files);
      setHomeDirectory(path);
      return path;
    } catch {
      return null;
    }
  }, [files, homeDirectory, needsHomeDirectory]);

  return {
    homeDirectory,
    needsHomeDirectory,
    pending,
    resolveHomeDirectory,
  };
}
