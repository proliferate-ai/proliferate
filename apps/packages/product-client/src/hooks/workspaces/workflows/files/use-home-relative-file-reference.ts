import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopFilesBridge } from "@proliferate/product-client/host/desktop-bridge";
import { normalizeRuntimeWorkspaceRoot } from "#product/lib/domain/files/path-references";

const cachedHomeDirectoryPromises = new WeakMap<DesktopFilesBridge, Promise<string>>();

function loadHomeDirectory(files: DesktopFilesBridge): Promise<string> {
  let promise = cachedHomeDirectoryPromises.get(files);
  if (!promise) {
    promise = files.getHomeDirectory().then((path) => {
      const normalized = normalizeRuntimeWorkspaceRoot(path);
      if (!normalized) throw new Error("Desktop home directory is unavailable.");
      return normalized;
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

interface HomeResolution {
  files: DesktopFilesBridge;
  candidatePath: string;
  homeDirectory: string | null;
  pending: boolean;
  rejected: boolean;
}

/** Resolve only an already authority-gated home-relative candidate. */
export function useHomeRelativeFileReference({
  files,
  candidatePath,
}: {
  files: DesktopFilesBridge | null;
  candidatePath: string | null;
}) {
  const routeRef = useRef({ files, candidatePath });
  routeRef.current = { files, candidatePath };
  const [resolution, setResolution] = useState<HomeResolution | null>(null);
  const current = files
    && candidatePath
    && resolution?.files === files
    && resolution.candidatePath === candidatePath
    ? resolution
    : null;

  useEffect(() => {
    let cancelled = false;
    if (!candidatePath || !files) {
      setResolution(null);
      return;
    }

    const pending: HomeResolution = {
      files,
      candidatePath,
      homeDirectory: null,
      pending: true,
      rejected: false,
    };
    setResolution(pending);
    void loadHomeDirectory(files).then(
      (homeDirectory) => {
        if (!cancelled) setResolution({ ...pending, homeDirectory, pending: false });
      },
      () => {
        if (!cancelled) setResolution({ ...pending, pending: false, rejected: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [candidatePath, files]);

  const resolveHomeDirectory = useCallback(async () => {
    const route = routeRef.current;
    if (!route.candidatePath || !route.files) return null;
    const active = resolution?.files === route.files
      && resolution.candidatePath === route.candidatePath
      ? resolution
      : null;
    if (active?.rejected) return null;
    if (active?.homeDirectory) return active.homeDirectory;
    try {
      const homeDirectory = await loadHomeDirectory(route.files);
      if (
        routeRef.current.files !== route.files
        || routeRef.current.candidatePath !== route.candidatePath
      ) return null;
      setResolution({
        files: route.files,
        candidatePath: route.candidatePath,
        homeDirectory,
        pending: false,
        rejected: false,
      });
      return homeDirectory;
    } catch {
      if (
        routeRef.current.files === route.files
        && routeRef.current.candidatePath === route.candidatePath
      ) {
        setResolution({
          files: route.files,
          candidatePath: route.candidatePath,
          homeDirectory: null,
          pending: false,
          rejected: true,
        });
      }
      return null;
    }
  }, [resolution]);

  return {
    homeDirectory: current?.homeDirectory ?? null,
    pending: Boolean(files && candidatePath && (!current || current.pending)),
    rejected: current?.rejected ?? false,
    resolveHomeDirectory,
  };
}
