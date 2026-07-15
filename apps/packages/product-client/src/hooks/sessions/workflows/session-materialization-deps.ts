import type {
  SessionMaterializationDeps,
} from "#product/lib/workflows/sessions/session-materialization";
import {
  getMaterializedSessionId,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

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
