import type { SessionEventEnvelope } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  mergeFetchedHistoryWithExistingEvents,
  mergeFetchedHistoryWithNewerEvents,
} from "@/lib/domain/sessions/history/history-event-merge";

function event(seq: number, marker = `event-${seq}`): SessionEventEnvelope {
  return { seq, marker } as unknown as SessionEventEnvelope;
}

describe("mergeFetchedHistoryWithNewerEvents", () => {
  it("keeps fetched history and appends newer current events by seq", () => {
    const fetched = [event(1), event(3)];
    const current = [event(2), event(5), event(4)];

    expect(mergeFetchedHistoryWithNewerEvents(fetched, current)).toEqual([
      event(1),
      event(3),
      event(4),
      event(5),
    ]);
  });

  it("returns fetched events when current has no newer events", () => {
    const fetched = [event(1), event(3)];
    const current = [event(1), event(2), event(3)];

    expect(mergeFetchedHistoryWithNewerEvents(fetched, current)).toBe(fetched);
  });

  it("does not append current events when fetched history has no positive seq tail", () => {
    const fetched = [event(0)];
    const current = [event(1)];

    expect(mergeFetchedHistoryWithNewerEvents(fetched, current)).toBe(fetched);
  });
});

describe("mergeFetchedHistoryWithExistingEvents", () => {
  it("merges by seq and lets fetched history replace existing events", () => {
    const current = [event(2, "current-2"), event(4, "current-4")];
    const fetched = [event(1, "fetched-1"), event(2, "fetched-2")];

    expect(mergeFetchedHistoryWithExistingEvents(fetched, current)).toEqual([
      event(1, "fetched-1"),
      event(2, "fetched-2"),
      event(4, "current-4"),
    ]);
  });

  it("returns current events when fetched history is empty", () => {
    const current = [event(2), event(4)];

    expect(mergeFetchedHistoryWithExistingEvents([], current)).toBe(current);
  });
});
