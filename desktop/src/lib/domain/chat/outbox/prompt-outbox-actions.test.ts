import { describe, expect, it } from "vitest";
import { createPromptOutboxEntry } from "./prompt-outbox-model";
import type { PromptOutboxDeliveryState } from "./prompt-outbox-model";
import {
  canCancelPromptOutboxEntryLocally,
  canDismissPromptOutboxEntry,
  canRetryPromptOutboxEntry,
} from "./prompt-outbox-actions";

const DELIVERY_STATES: PromptOutboxDeliveryState[] = [
  "waiting_for_session",
  "preparing",
  "dispatching",
  "accepted_running",
  "accepted_queued",
  "unknown_after_dispatch",
  "failed_before_dispatch",
  "cancelled",
  "echoed_tombstone",
];

function entryWithState(deliveryState: PromptOutboxDeliveryState) {
  return {
    ...createPromptOutboxEntry({
      clientPromptId: `prompt-${deliveryState}`,
      clientSessionId: "session-1",
      text: "hello",
      blocks: [{ type: "text", text: "hello" }],
      now: "2026-01-01T00:00:00.000Z",
    }),
    deliveryState,
  };
}

describe("prompt outbox action predicates", () => {
  it("allows retry only for failed-before-dispatch prompts", () => {
    expect(DELIVERY_STATES.filter((state) =>
      canRetryPromptOutboxEntry(entryWithState(state))
    )).toEqual(["failed_before_dispatch"]);
  });

  it("allows dismiss for local failures and unknown post-dispatch prompts", () => {
    expect(DELIVERY_STATES.filter((state) =>
      canDismissPromptOutboxEntry(entryWithState(state))
    )).toEqual(["unknown_after_dispatch", "failed_before_dispatch"]);
  });

  it("allows local cancel only before the request starts", () => {
    expect(DELIVERY_STATES.filter((state) =>
      canCancelPromptOutboxEntryLocally(entryWithState(state))
    )).toEqual(["waiting_for_session", "preparing"]);
  });
});
