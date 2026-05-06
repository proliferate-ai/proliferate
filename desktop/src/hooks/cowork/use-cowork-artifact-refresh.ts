import {
  anyHarnessCoworkArtifactKey,
  anyHarnessCoworkManifestKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import {
  offTurnEnd,
  onTurnEnd,
  type TurnEndCallback,
} from "@/lib/integrations/anyharness/turn-end-events";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { getSessionRecord } from "@/stores/sessions/session-records";

export function useCoworkArtifactRefresh(
  workspaceId: string | null | undefined,
  artifactId: string | null | undefined,
) {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const artifactIdRef = useRef<string | null | undefined>(artifactId);
  artifactIdRef.current = artifactId;

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkManifestKey(runtimeUrl, workspaceId),
    });

    const currentArtifactId = artifactIdRef.current;
    if (currentArtifactId) {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessCoworkArtifactKey(runtimeUrl, workspaceId, currentArtifactId),
      });
    }
  }, [queryClient, runtimeUrl, workspaceId]);

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
