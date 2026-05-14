import type { CloudSessionConfigState } from "../types/index.js";
import { enqueueCommand } from "./commands.js";

export interface UpdateSessionConfigPayload {
  configVersion?: number | null;
  patch: Record<string, unknown>;
}

export async function updateSessionConfig(
  input: {
    idempotencyKey: string;
    targetId: string;
    workspaceId?: string | null;
    sessionId: string;
    payload: UpdateSessionConfigPayload;
    observedEventSeq?: number | null;
  },
) {
  return enqueueCommand<UpdateSessionConfigPayload>({
    idempotencyKey: input.idempotencyKey,
    targetId: input.targetId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    kind: "update_session_config",
    payload: input.payload,
    observedEventSeq: input.observedEventSeq,
  });
}

export type { CloudSessionConfigState };

