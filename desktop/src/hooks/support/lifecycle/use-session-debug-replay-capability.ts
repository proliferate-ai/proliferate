import { useEffect, useState } from "react";
import type {
  SessionDebugActionDependencies,
  SessionDebugRuntimeConnection,
} from "@/lib/workflows/support/session-debug-export-workflows";

interface UseSessionDebugReplayCapabilityInput<
  Connection extends SessionDebugRuntimeConnection,
> {
  activeSessionWorkspaceId: string | null;
  dependencies: SessionDebugActionDependencies<Connection>;
}

/**
 * Owns probing runtime replay export capability for support debugging.
 * Does not own replay recording export actions.
 */
export function useSessionDebugReplayCapability<
  Connection extends SessionDebugRuntimeConnection,
>({
  activeSessionWorkspaceId,
  dependencies,
}: UseSessionDebugReplayCapabilityInput<Connection>): boolean {
  const [replayExportAvailable, setReplayExportAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReplayExportAvailable(false);
    if (!import.meta.env.DEV || !activeSessionWorkspaceId) {
      return () => {
        cancelled = true;
      };
    }
    const workspaceId = activeSessionWorkspaceId;

    async function refreshReplayCapability() {
      try {
        const resolved = await dependencies.resolveWorkspace(workspaceId);
        const health = await dependencies.getClient(resolved.connection).runtime.getHealth();
        if (!cancelled) {
          setReplayExportAvailable(health.capabilities?.replay === true);
        }
      } catch {
        if (!cancelled) {
          setReplayExportAvailable(false);
        }
      }
    }

    void refreshReplayCapability();
    return () => {
      cancelled = true;
    };
  }, [activeSessionWorkspaceId, dependencies]);

  return replayExportAvailable;
}
