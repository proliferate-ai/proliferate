import { describe, expect, it } from "vitest";
import { createTranscriptState, reduceEvent, reduceEvents } from "../../index.js";
import { nativeSubagentFixtures } from "./native-subagent-fixtures.js";

describe.each(nativeSubagentFixtures)("$provider native subagent transcript", (fixture) => {
  it("keeps stable identity, ordering, nesting, and completion in live and replay reduction", () => {
    const replay = reduceEvents(fixture.events, `${fixture.provider}-session`, { replayMode: true });
    const live = fixture.events.reduce(reduceEvent, createTranscriptState(`${fixture.provider}-session`));

    expect(live).toEqual(replay);
    expect(live.turnOrder).toEqual([`${fixture.provider}-turn`]);
    expect(live.turnsById[`${fixture.provider}-turn`]?.itemOrder).toEqual([
      fixture.parentId,
      fixture.childMessageId,
      fixture.childToolId,
    ]);
    expect(live.itemsById[fixture.parentId]).toMatchObject({
      kind: "tool_call",
      status: "completed",
      nativeToolName: "Agent",
    });
    expect(live.itemsById[fixture.childMessageId]).toMatchObject({
      kind: "assistant_prose",
      status: "completed",
      messageId: fixture.childMessageId,
      parentToolCallId: fixture.parentId,
    });
    expect(live.itemsById[fixture.childToolId]).toMatchObject({
      kind: "tool_call",
      status: "completed",
      parentToolCallId: fixture.parentId,
    });
  });
});
