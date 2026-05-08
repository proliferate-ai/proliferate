import { useCallback, useEffect, useRef } from "react";
import { useCoworkCache } from "@/hooks/access/anyharness/cowork/use-cowork-cache";
import {
  offTurnEnd,
  onTurnEnd,
  type TurnEndCallback,
} from "@/lib/infra/events/turn-end-events";
import { getSessionRecord } from "@/stores/sessions/session-records";

// Owns artifact refresh triggers for a mounted Cowork artifacts surface.
// AnyHarness query-cache shape stays in the Cowork access cache hook.
export function useCoworkArtifactRefresh(
  workspaceId: string | null | undefined,
  artifactId: string | null | undefined,
) {
  const { invalidateCoworkArtifact, invalidateCoworkArtifactManifest } = useCoworkCache();
  const artifactIdRef = useRef<string | null | undefined>(artifactId);
  artifactIdRef.current = artifactId;

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      return;
    }

    await invalidateCoworkArtifactManifest(workspaceId);

    const currentArtifactId = artifactIdRef.current;
    if (currentArtifactId) {
      await invalidateCoworkArtifact(workspaceId, currentArtifactId);
    }
  }, [invalidateCoworkArtifact, invalidateCoworkArtifactManifest, workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      return undefined;
    }

    const handleTurnEnd: TurnEndCallback = (sessionId) => {
      const slot = getSessionRecord(sessionId);
      if (slot?.workspaceId !== workspaceId) {
        return;
      }

      void refresh();
    };

    onTurnEnd(handleTurnEnd);
    return () => {
      offTurnEnd(handleTurnEnd);
    };
  }, [refresh]);

  return {
    refresh,
  };
}
