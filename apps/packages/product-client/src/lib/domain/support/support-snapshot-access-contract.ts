import type {
  DesktopRuntimeBridge,
  SupportSnapshotSelectionV1,
  SupportSnapshotWorkspaceBindingV1,
} from "@proliferate/product-client/host/desktop-bridge";
declare const resolvedBundledLocalSupportAccessBrand: unique symbol;

export type SupportWorkspaceCandidate =
  | {
      kind: "bundled_local";
      workspaceId: string;
      anyharnessWorkspaceId: string;
    }
  | {
      kind: "cloud" | "standalone" | "supervisor_owned";
      workspaceId: string;
    };

export interface SupportActiveSessionCandidate {
  uiSessionId: string;
  directoryWorkspaceId: string | null;
  materializedSessionId: string | null;
}

export type BundledLocalSupportSelection =
  | Extract<SupportSnapshotSelectionV1, { kind: "active_session" }>
  | (Extract<SupportSnapshotSelectionV1, { kind: "recent_activity" }> & {
      workspace: Extract<SupportSnapshotWorkspaceBindingV1, { kind: "bundled_local" }>;
    });

export type ResolveSupportSnapshotAccessInput = {
  selection: "active_session" | "recent_activity";
  capturedRuntime: {
    url: string;
    source: "native_capture" | "default_fallback";
  };
  selectedWorkspace: SupportWorkspaceCandidate | null;
  activeSession?: SupportActiveSessionCandidate | null;
  runtime: DesktopRuntimeBridge | null;
};

export type ResolvedSupportSnapshotAccess =
  | {
      state: "resolved";
      selection: BundledLocalSupportSelection;
      readonly [resolvedBundledLocalSupportAccessBrand]: true;
    }
  | {
      state: "none";
      binding: Extract<SupportSnapshotWorkspaceBindingV1, { kind: "none" }>;
    }
  | {
      state: "ineligible";
      reason:
        | "native_capability_unavailable"
        | "captured_runtime_untrusted"
        | "runtime_unhealthy"
        | "runtime_mismatch"
        | "workspace_ineligible"
        | "session_mapping_stale";
    };
