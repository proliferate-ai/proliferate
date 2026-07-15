import type { PromptCapabilities } from "@anyharness/sdk";
import { isSessionSlotBusy } from "@proliferate/product-domain/sessions/activity";
import { useRef } from "react";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/selection/workspace-ui-key";

export function useActiveSessionId(): string | null {
  return useSessionSelectionStore((state) => state.activeSessionId);
}

export function useActiveSessionWorkspaceId(): string | null {
  const activeSessionId = useActiveSessionId();
  return useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.workspaceId ?? null : null
  );
}

export function useSelectedWorkspaceUiKey(): string | null {
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  return resolveWorkspaceUiKey(selectedLogicalWorkspaceId, selectedWorkspaceId);
}

export function useActiveSessionPromptCapabilities(): PromptCapabilities | null {
  const activeSessionId = useActiveSessionId();
  const capabilities = useSessionDirectoryStore((state) =>
    activeSessionId
      ? state.entriesById[activeSessionId]?.liveConfig?.promptCapabilities ?? null
      : null
  );
  return useStablePromptCapabilities(capabilities);
}

export function useActiveSessionRunningState(): boolean {
  const activeSessionId = useActiveSessionId();
  return useSessionDirectoryStore((state) =>
    activeSessionId
      ? isSessionSlotBusy(activitySnapshotFromDirectoryEntry(state.entriesById[activeSessionId]))
      : false
  );
}

export function useActiveSessionCanCancelState(): boolean {
  const activeSessionId = useActiveSessionId();
  return useSessionDirectoryStore((state) =>
    activeSessionId
      ? Boolean(state.entriesById[activeSessionId]?.materializedSessionId)
      : false
  );
}

function useStablePromptCapabilities(
  capabilities: PromptCapabilities | null,
): PromptCapabilities | null {
  const ref = useRef<{ signature: string; value: PromptCapabilities | null } | null>(null);
  const signature = promptCapabilitiesSignature(capabilities);
  if (ref.current?.signature === signature) {
    return ref.current.value;
  }
  ref.current = { signature, value: capabilities };
  return capabilities;
}

function promptCapabilitiesSignature(capabilities: PromptCapabilities | null): string {
  if (!capabilities) {
    return "null";
  }
  return JSON.stringify({
    audio: capabilities.audio === true,
    embeddedContext: capabilities.embeddedContext === true,
    image: capabilities.image === true,
  });
}
