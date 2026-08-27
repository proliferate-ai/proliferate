import type { ReportSeatLimitHitRequest } from "@proliferate/cloud-sdk";

/**
 * The courier's limit-hit relay core (agent_auth spec §4 cell 3,
 * `reportSeatLimitHit`): when a session's error stream delivers a
 * `seat_usage_limit` turn error, the observed hit is reported upward to
 * `POST /v1/cloud/agent-auth/seats/{key_id}/limit-hit` so the server's meters
 * and the `agent_seat_limit_hit` audit event see it.
 *
 * Fire-and-forget by law: cooling is runtime-local and never waits on this
 * report. A failed POST is swallowed with a debug log and NEVER retried — the
 * usage probe (flow 5's soft signal) converges the meters on its own cadence.
 *
 * Pure decision + injected client: the poster is injected so the dedupe and
 * failure semantics are unit-testable; the app-wired singleton lives in
 * `lib/access/cloud/seat-limit-report.ts`.
 */

export interface SeatLimitHitObservation {
  /** The runtime session the error event belongs to. */
  sessionId: string;
  /** The event's stream sequence — with sessionId, the event's identity. */
  seq: number;
  /** The vault entry id of the seat that hit its limit. */
  seatId: string;
  window: "five_hour" | "seven_day" | null;
  /** RFC3339 UTC reset instant carried by the error. */
  resetAt: string;
}

export type SeatLimitHitPoster = (
  seatId: string,
  body: ReportSeatLimitHitRequest,
) => Promise<void>;

export interface SeatLimitHitRelay {
  /**
   * Report one observed hit exactly once per distinct error event (in-memory
   * dedupe keyed by session + event seq — a reconnect replaying the same
   * envelope reports nothing). Returns whether a report was dispatched.
   */
  relay: (observation: SeatLimitHitObservation) => boolean;
}

export function createSeatLimitHitRelay(post: SeatLimitHitPoster): SeatLimitHitRelay {
  const reportedEventKeys = new Set<string>();
  return {
    relay(observation) {
      const eventKey = `${observation.sessionId}:${observation.seq}`;
      if (reportedEventKeys.has(eventKey)) {
        return false;
      }
      reportedEventKeys.add(eventKey);
      void Promise.resolve()
        .then(() =>
          post(observation.seatId, {
            window: observation.window,
            resetAt: observation.resetAt,
          })
        )
        .catch((error: unknown) => {
          // Swallowed on purpose: advisory report, no retry loop, never
          // blocks UI. The dedupe entry stays — one attempt per event.
          console.debug("[agent-auth] seat limit-hit report failed", error);
        });
      return true;
    },
  };
}
