import type { SessionEventEnvelope } from "@anyharness/sdk";

export type DevSSEEventStatus = "applied" | "duplicate" | "gap";

export type DevSSEEventRecord = {
  sessionId: string;
  receivedAt: string;
  status: DevSSEEventStatus;
  envelope: SessionEventEnvelope;
};
