import { reportSeatLimitHit } from "@proliferate/cloud-sdk";
import {
  createSeatLimitHitRelay,
  type SeatLimitHitObservation,
} from "#product/lib/domain/agents/seat-limit-relay";

/**
 * App-wired seat limit-hit relay (the access half of
 * `lib/domain/agents/seat-limit-relay.ts`): posts through the default
 * Proliferate cloud client, one report per distinct error event for the app's
 * lifetime. Fire-and-forget — see the domain core for the semantics.
 */
const appSeatLimitHitRelay = createSeatLimitHitRelay((seatId, body) =>
  reportSeatLimitHit(seatId, body)
);

export function relaySeatLimitHit(observation: SeatLimitHitObservation): boolean {
  return appSeatLimitHitRelay.relay(observation);
}
