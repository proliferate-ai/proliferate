import { AnyHarnessError } from "@anyharness/sdk";
import type { NativeFileReferenceCapability } from "#product/hooks/workspaces/workflows/files/use-desktop-file-reference-actions";
import {
  resolveInspectionPathKind,
  type DesktopPathInspectionState,
} from "#product/hooks/workspaces/workflows/files/use-desktop-path-inspection";
import {
  resolveWorkspaceStatPathKind,
  type FileReferencePathKind,
  type FileReferenceUnavailableLocatorReason,
  type ResolvedFileLocator,
} from "#product/lib/domain/files/path-references";

export type FileReferenceUnavailableReason =
  | FileReferenceUnavailableLocatorReason
  | "not_found"
  | "permission_denied"
  | "outside_workspace"
  | "unsupported_type"
  | "unexpected_kind"
  | "ambiguous_match"
  | "runtime_unavailable"
  | "io_error";

export type AccessibleFileLocator = Exclude<
  ResolvedFileLocator,
  { authority: "unavailable" }
>;

export type FileReferenceAccessState =
  | { status: "pending"; locator: AccessibleFileLocator }
  | { status: "settled"; locator: AccessibleFileLocator; kind: FileReferencePathKind }
  | {
      status: "exact-missing";
      locator: Extract<AccessibleFileLocator, { authority: "workspace" }>;
      fuzzyAttempted: false;
    }
  | {
      status: "recovering";
      locator: Extract<AccessibleFileLocator, { authority: "workspace" }>;
    }
  | { status: "unavailable"; reason: FileReferenceUnavailableReason };

export type FileReferenceRecoveryState =
  | { recoveryRevision: object; status: "recovering" }
  | {
      recoveryRevision: object;
      status: "settled";
      locator: Extract<AccessibleFileLocator, { authority: "workspace" }>;
    }
  | {
      recoveryRevision: object;
      status: "terminal";
      reason: FileReferenceUnavailableReason;
    }
  | null;

export function resolveFileReferenceAccessState(args: {
  locator: ResolvedFileLocator;
  materializedWorkspaceId: string | null;
  statData: { kind: "file" | "directory" | "symlink" } | undefined;
  statError: unknown;
  statPending: boolean;
  desktopInspectionState: DesktopPathInspectionState;
  recovery: FileReferenceRecoveryState;
}): FileReferenceAccessState {
  if (args.locator.authority === "unavailable") {
    return { status: "unavailable", reason: args.locator.reason };
  }
  if (args.locator.authority === "desktop") {
    const kind = resolveInspectionPathKind(args.desktopInspectionState);
    if (kind) return { status: "settled", locator: args.locator, kind };
    if (args.desktopInspectionState.status === "settled") {
      const inspection = args.desktopInspectionState.inspection;
      if (inspection.kind === "missing") {
        return { status: "unavailable", reason: "not_found" };
      }
      if (inspection.kind === "unavailable") {
        return { status: "unavailable", reason: inspectionReason(inspection.reason) };
      }
    }
    return args.desktopInspectionState.status === "rejected"
      ? { status: "unavailable", reason: "io_error" }
      : { status: "pending", locator: args.locator };
  }
  if (!args.materializedWorkspaceId) {
    return { status: "unavailable", reason: "runtime_unavailable" };
  }
  if (args.recovery?.status === "recovering") {
    return { status: "recovering", locator: args.locator };
  }
  if (args.recovery?.status === "terminal") {
    return { status: "unavailable", reason: args.recovery.reason };
  }
  if (args.recovery?.status === "settled") {
    return { status: "settled", locator: args.recovery.locator, kind: "file" };
  }
  const kind = resolveWorkspaceStatPathKind(args.statData);
  if (kind) return { status: "settled", locator: args.locator, kind };
  if (args.statData?.kind === "symlink") {
    return { status: "unavailable", reason: "unexpected_kind" };
  }
  if (args.statError) {
    if (isExactFileMissing(args.statError) && args.locator.workspacePath !== "") {
      return { status: "exact-missing", locator: args.locator, fuzzyAttempted: false };
    }
    return { status: "unavailable", reason: fileReferenceAccessReason(args.statError) };
  }
  return args.statPending
    ? { status: "pending", locator: args.locator }
    : { status: "unavailable", reason: "runtime_unavailable" };
}

export function resolveNativeFileReferenceCapability(
  state: FileReferenceAccessState,
  routeRevision: object,
): NativeFileReferenceCapability | null {
  if (state.status !== "settled") return null;
  if (state.locator.authority === "desktop") {
    return {
      source: "desktop",
      absolutePath: state.locator.absolutePath,
      kind: state.kind,
      routeRevision,
    };
  }
  if (!state.locator.localCompanionPath) return null;
  return {
    source: "workspace-companion",
    absolutePath: state.locator.localCompanionPath,
    kind: state.kind,
    routeRevision,
  };
}

export function isExactFileMissing(error: unknown): boolean {
  return error instanceof AnyHarnessError && error.problem.code === "FILE_NOT_FOUND";
}

export function fileReferenceAccessReason(error: unknown): FileReferenceUnavailableReason {
  if (!(error instanceof AnyHarnessError)) return "runtime_unavailable";
  switch (error.problem.code) {
    case "FILE_NOT_FOUND": return "not_found";
    case "FILE_PERMISSION_DENIED": return "permission_denied";
    case "PATH_OUTSIDE_WORKSPACE": return "outside_workspace";
    case "INVALID_FILE_PATH": return "invalid";
    case "NOT_A_DIRECTORY": return "unexpected_kind";
    default: return error.problem.status >= 500 ? "io_error" : "runtime_unavailable";
  }
}

export function fileReferenceUnavailableCopy(
  state: FileReferenceAccessState,
): string | null {
  if (state.status === "pending" || state.status === "recovering") {
    return "Checking whether this path is a file or folder…";
  }
  if (state.status === "exact-missing") {
    return "This path was not found. Search for a match.";
  }
  if (state.status !== "unavailable") return null;
  if (state.reason === "not_found") return "This path was not found.";
  if (state.reason === "permission_denied") return "Permission denied for this path.";
  if (state.reason === "invalid") return "This path is invalid.";
  if (state.reason === "unsupported_type" || state.reason === "unexpected_kind") {
    return "This path type is not supported.";
  }
  return "This path is unavailable.";
}

function inspectionReason(
  reason: "invalid_path" | "permission_denied" | "unsupported_type" | "io_error",
): FileReferenceUnavailableReason {
  switch (reason) {
    case "invalid_path": return "invalid";
    case "permission_denied": return "permission_denied";
    case "unsupported_type": return "unsupported_type";
    case "io_error": return "io_error";
  }
}
