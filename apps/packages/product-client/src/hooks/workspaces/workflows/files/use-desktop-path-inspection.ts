import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesktopFilesBridge,
  DesktopPathInspection,
} from "@proliferate/product-client/host/desktop-bridge";
import type { FileReferencePathKind } from "#product/lib/domain/files/path-references";

export type DesktopPathInspectionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "settled"; inspection: DesktopPathInspection }
  | { status: "rejected" };

interface DesktopPathInspectionAttempt {
  routeRevision: object;
  files: DesktopFilesBridge;
  path: string;
  state: DesktopPathInspectionState;
  promise: Promise<DesktopPathInspection | null> | null;
}

interface DesktopPathInspectionSnapshot {
  routeRevision: object;
  files: DesktopFilesBridge;
  path: string;
  state: DesktopPathInspectionState;
}

export const IDLE_DESKTOP_PATH_INSPECTION: DesktopPathInspectionState = {
  status: "idle",
};

export function resolveInspectionPathKind(
  state: DesktopPathInspectionState,
): FileReferencePathKind | null {
  if (state.status !== "settled") {
    return null;
  }
  return state.inspection.kind === "file" || state.inspection.kind === "directory"
    ? state.inspection.kind
    : null;
}

export function resolveInspectionUnavailableCopy(
  state: DesktopPathInspectionState,
): string | null {
  if (state.status === "idle" || state.status === "pending") {
    return "Checking whether this path is a file or folder…";
  }
  if (state.status === "rejected") {
    return "This path is unavailable.";
  }
  if (state.inspection.kind === "missing") {
    return "This path was not found.";
  }
  if (state.inspection.kind !== "unavailable") {
    return null;
  }
  switch (state.inspection.reason) {
    case "invalid_path":
      return "This path is invalid.";
    case "permission_denied":
      return "Permission denied for this path.";
    case "unsupported_type":
      return "This path type is not supported.";
    case "io_error":
      return "This path is unavailable.";
  }
}

export function useDesktopPathInspection({
  candidatePath,
  files,
  routeRevision,
}: {
  candidatePath: string | null;
  files: DesktopFilesBridge | null;
  routeRevision: object;
}) {
  const currentRouteRevisionRef = useRef(routeRevision);
  currentRouteRevisionRef.current = routeRevision;
  const mountedRef = useRef(true);
  const attemptRef = useRef<DesktopPathInspectionAttempt | null>(null);
  const [snapshot, setSnapshot] = useState<DesktopPathInspectionSnapshot | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const publish = useCallback((
    attempt: DesktopPathInspectionAttempt,
    state: DesktopPathInspectionState,
  ): boolean => {
    attempt.state = state;
    if (
      !mountedRef.current
      || attemptRef.current !== attempt
      || currentRouteRevisionRef.current !== attempt.routeRevision
    ) {
      return false;
    }
    setSnapshot({
      routeRevision: attempt.routeRevision,
      files: attempt.files,
      path: attempt.path,
      state,
    });
    return true;
  }, []);

  const ensureInspection = useCallback((
    path: string,
  ): Promise<DesktopPathInspection | null> => {
    if (!files || currentRouteRevisionRef.current !== routeRevision) {
      return Promise.resolve(null);
    }

    let attempt = attemptRef.current;
    if (
      !attempt
      || attempt.routeRevision !== routeRevision
      || attempt.files !== files
      || attempt.path !== path
    ) {
      attempt = {
        routeRevision,
        files,
        path,
        state: IDLE_DESKTOP_PATH_INSPECTION,
        promise: null,
      };
      attemptRef.current = attempt;
    }

    if (attempt.state.status === "settled") {
      return Promise.resolve(attempt.state.inspection);
    }
    if (attempt.state.status === "rejected") {
      return Promise.resolve(null);
    }
    if (attempt.promise) {
      return attempt.promise;
    }

    publish(attempt, { status: "pending" });
    const activeAttempt = attempt;
    const promise = Promise.resolve().then(() => files.inspectPath(path)).then(
      (inspection) => {
        const isCurrent = publish(activeAttempt, { status: "settled", inspection });
        activeAttempt.promise = null;
        return isCurrent ? inspection : null;
      },
      () => {
        publish(activeAttempt, { status: "rejected" });
        activeAttempt.promise = null;
        return null;
      },
    );
    activeAttempt.promise = promise;
    return promise;
  }, [files, publish, routeRevision]);

  const state = candidatePath
    && files
    && snapshot?.routeRevision === routeRevision
    && snapshot.files === files
    && snapshot.path === candidatePath
    ? snapshot.state
    : IDLE_DESKTOP_PATH_INSPECTION;

  useEffect(() => {
    if (files && candidatePath) {
      void ensureInspection(candidatePath);
    }
  }, [candidatePath, ensureInspection, files]);

  return { ensureInspection, state };
}
