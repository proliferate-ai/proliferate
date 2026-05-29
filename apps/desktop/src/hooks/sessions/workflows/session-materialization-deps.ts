import type {
  SessionMaterializationDeps,
} from "@/lib/workflows/sessions/session-materialization";
import {
  getMaterializedSessionId,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

export const sessionMaterializationDeps: SessionMaterializationDeps = {
  getMaterializedSessionId,
  subscribeToMaterializedSessionId: (clientSessionId, onChange) => {
    let lastMaterializedSessionId = getMaterializedSessionId(clientSessionId);
    return useSessionDirectoryStore.subscribe((state) => {
      const nextMaterializedSessionId =
        state.entriesById[clientSessionId]?.materializedSessionId ?? null;
      if (nextMaterializedSessionId === lastMaterializedSessionId) {
        return;
      }
      lastMaterializedSessionId = nextMaterializedSessionId;
      onChange(nextMaterializedSessionId);
    });
  },
};
