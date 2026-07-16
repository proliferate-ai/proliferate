import { useEffect, useRef } from "react";
import { useMaterializationHealthPass } from "#product/hooks/workspaces/workflows/use-materialization-health-pass";
import { useStandardRepoProjection } from "#product/hooks/workspaces/derived/use-standard-repo-projection";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

/**
 * PR 6 — the connected driver that runs the materialization reconciliation
 * health pass on Desktop startup and on relevant workspace selection. Mounted
 * once next to the availability host (App). The pass is bounded (current-install
 * rows vs local inventory) and idempotent (a session-scoped memo suppresses
 * re-reporting unchanged states), so firing on load + selection change never
 * thrashes the ledger. Explicit Retry is exposed separately from the
 * reconciliation dialog. This component renders nothing.
 */
export function MaterializationHealthPassHost() {
  const runHealthPass = useMaterializationHealthPass();
  const { cloudWorkspaces, isLoading } = useStandardRepoProjection();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const didStartupRef = useRef(false);
  const lastSelectionRef = useRef<string | null>(null);

  // Startup: once cloud workspaces have first loaded.
  useEffect(() => {
    if (isLoading || didStartupRef.current || cloudWorkspaces.length === 0) {
      return;
    }
    didStartupRef.current = true;
    void runHealthPass(cloudWorkspaces);
  }, [cloudWorkspaces, isLoading, runHealthPass]);

  // Relevant workspace selection change.
  useEffect(() => {
    if (!selectedWorkspaceId || selectedWorkspaceId === lastSelectionRef.current) {
      return;
    }
    lastSelectionRef.current = selectedWorkspaceId;
    if (cloudWorkspaces.length > 0) {
      void runHealthPass(cloudWorkspaces);
    }
  }, [cloudWorkspaces, runHealthPass, selectedWorkspaceId]);

  return null;
}
