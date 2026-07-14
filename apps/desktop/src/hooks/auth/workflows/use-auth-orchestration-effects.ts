import { useMemo } from "react";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import { closeAllSessionStreamHandles } from "@/lib/access/anyharness/session-stream-handles";
import type { AuthClientStatePatch } from "@/lib/domain/auth/auth-state-mapping";
import type { AuthOrchestrationDeps } from "@/lib/integrations/auth/orchestration-effects";
import { useAuthStore } from "@/stores/auth/auth-store";
import { clearSelectedOrganizationCookie } from "@/lib/access/browser/organization-selection-cookie";
import { useOrganizationStore } from "@/stores/organizations/organization-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useRepoSetupModalStore } from "@/stores/ui/repo-setup-modal-store";

// Owns auth orchestration's store/runtime effect wiring. Does not own the auth network flow.
export function useAuthOrchestrationEffects(
  cloudClient: ProliferateCloudClient | null = null,
): AuthOrchestrationDeps {
  return useMemo(() => ({
    cloudClient,
    getAuthState: () => useAuthStore.getState(),
    setAuthState: (state: AuthClientStatePatch) => {
      useAuthStore.setState(state);
    },
    clearSessionRuntimeState: () => {
      closeAllSessionStreamHandles();
      clearSelectedOrganizationCookie();
      useOrganizationStore.getState().clearActiveOrganizationId();
      useSessionDirectoryStore.getState().clearEntries();
      useSessionTranscriptStore.getState().clearEntries();
      useSessionSelectionStore.getState().clearSelection();
    },
    closeRepoSetupModal: () => {
      useRepoSetupModalStore.getState().close();
    },
    showToast: (message: string) => {
      useToastStore.getState().show(message);
    },
  }), [cloudClient]);
}
