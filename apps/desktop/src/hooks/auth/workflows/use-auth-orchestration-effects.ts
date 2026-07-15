import { useMemo } from "react";
import { closeAllSessionStreamHandles } from "@proliferate/product-client/internal/lib/access/anyharness/session-stream-handles";
import type { AuthClientStatePatch } from "@proliferate/product-client/internal/lib/domain/auth/auth-state-mapping";
import type { AuthOrchestrationDeps } from "@/lib/integrations/auth/orchestration-effects";
import { useAuthStore } from "@/stores/auth/auth-store";
import { clearSelectedOrganizationCookie } from "@proliferate/product-client/internal/lib/access/browser/organization-selection-cookie";
import { useOrganizationStore } from "@proliferate/product-client/internal/stores/organizations/organization-store";
import { useSessionDirectoryStore } from "@proliferate/product-client/internal/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@proliferate/product-client/internal/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@proliferate/product-client/internal/stores/sessions/session-transcript-store";
import { useToastStore } from "@proliferate/product-client/internal/stores/toast/toast-store";
import { useRepoSetupModalStore } from "@proliferate/product-client/internal/stores/ui/repo-setup-modal-store";

// Owns auth orchestration's store/runtime effect wiring. Does not own the auth network flow.
export function useAuthOrchestrationEffects(): AuthOrchestrationDeps {
  return useMemo(() => ({
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
  }), []);
}
