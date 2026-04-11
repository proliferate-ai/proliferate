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
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function useCoworkArtifactRefresh(
  workspaceId: string | null | undefined,
  artifactId: string | null | undefined,
) {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
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
      const slot = useHarnessStore.getState().sessionSlots[sessionId];
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
