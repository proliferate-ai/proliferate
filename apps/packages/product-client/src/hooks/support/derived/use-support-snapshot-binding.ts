import { useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type {
  DesktopRuntimeBridge,
  DesktopSupportSnapshotBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import { isCloudWorkspaceId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import type {
  ResolveSupportSnapshotAccessInput,
  SupportActiveSessionCandidate,
  SupportWorkspaceCandidate,
} from "#product/lib/domain/support/support-snapshot-access-contract";
import {
  activeSessionScopeAvailable,
  defaultSupportSnapshotScope,
  supportSnapshotBindingKey,
  type SupportSnapshotScopeChoice,
} from "#product/lib/domain/support/support-snapshot-consent";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export interface SupportSnapshotBinding {
  /**
   * The packaged native support coordinator. Null on Web, Mobile, and any
   * Desktop build without it — the consent surface renders nothing there
   * rather than offering a control that cannot prepare anything.
   */
  bridge: DesktopSupportSnapshotBridge | null;
  /** Whether **Current session** may be offered for this binding. */
  activeSessionAvailable: boolean;
  /** The scope to start on: active session only when its mapping is exact. */
  defaultScope: SupportSnapshotScopeChoice;
  /** Changes to this key supersede the consent epoch. */
  bindingKey: string;
  /** The exact binding a preparation resolves against, per chosen scope. */
  accessInput: (scope: SupportSnapshotScopeChoice) => ResolveSupportSnapshotAccessInput;
}

/**
 * Derives the consent surface's workspace/session binding from state the app
 * already holds. Every read here is resident selection, directory, and runtime
 * connection state: rendering the consent choice performs no customer-detail
 * read, no collector export, no native staging, and no upload-intent mutation.
 */
export function useSupportSnapshotBinding(): SupportSnapshotBinding {
  const host = useProductHost();
  const bridge = host.desktop?.diagnostics?.supportSnapshot ?? null;
  const runtime: DesktopRuntimeBridge | null = host.desktop?.runtime ?? null;
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const runtimeUrlSource = useHarnessConnectionStore((state) => state.runtimeUrlSource);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const directoryEntries = useSessionDirectoryStore((state) => state.entriesById);

  return useMemo(() => {
    const selectedWorkspace = workspaceCandidate(selectedWorkspaceId);
    const activeSession = activeSessionCandidate(activeSessionId, directoryEntries);
    const candidates = { selectedWorkspace, activeSession };
    return {
      bridge,
      activeSessionAvailable: activeSessionScopeAvailable(candidates),
      defaultScope: defaultSupportSnapshotScope(candidates),
      bindingKey: supportSnapshotBindingKey(candidates),
      accessInput: (scope: SupportSnapshotScopeChoice) => ({
        selection: scope,
        capturedRuntime: { url: runtimeUrl, source: runtimeUrlSource },
        selectedWorkspace,
        activeSession,
        runtime,
      }),
    };
  }, [
    activeSessionId,
    bridge,
    directoryEntries,
    runtime,
    runtimeUrl,
    runtimeUrlSource,
    selectedWorkspaceId,
  ]);
}

/**
 * Only a bundled-local workspace can back a snapshot. Cloud, standalone,
 * Supervisor-owned, and remote runtimes are never substituted, so a synthetic
 * cloud ID classifies as `cloud` and stays ineligible. A local workspace ID is
 * the bundled AnyHarness workspace ID.
 */
function workspaceCandidate(workspaceId: string | null): SupportWorkspaceCandidate | null {
  if (!workspaceId) {
    return null;
  }
  if (isCloudWorkspaceId(workspaceId)) {
    return { kind: "cloud", workspaceId };
  }
  return { kind: "bundled_local", workspaceId, anyharnessWorkspaceId: workspaceId };
}

function activeSessionCandidate(
  activeSessionId: string | null,
  entriesById: Record<string, { workspaceId: string | null; materializedSessionId: string | null }>,
): SupportActiveSessionCandidate | null {
  if (!activeSessionId) {
    return null;
  }
  const entry = entriesById[activeSessionId];
  return {
    uiSessionId: activeSessionId,
    directoryWorkspaceId: entry?.workspaceId ?? null,
    materializedSessionId: entry?.materializedSessionId ?? null,
  };
}
