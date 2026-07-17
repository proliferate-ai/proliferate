import { describe, expect, it } from "vitest";
import type { SessionEventEnvelope, ToolCallItem } from "../../index.js";
import { reduceEvents } from "../../index.js";
import claudeFixtureJson from "../../../../../fixtures/contracts/native-subagent-transcript/claude.json";
import codexFixtureJson from "../../../../../fixtures/contracts/native-subagent-transcript/codex.json";

type NativeSubagentFixture = {
  provider: "claude" | "codex";
  sessionId: string;
  turnId: string;
  parentId: string;
  parentTerminalBeforeTurnEnd: boolean;
  childIds: string[];
  events: SessionEventEnvelope[];
};

const fixtures = [
  claudeFixtureJson,
  codexFixtureJson,
] as unknown as NativeSubagentFixture[];

describe.each(fixtures)("$provider native subagent transcript fixture", (fixture) => {
  it("preserves provider-neutral parent identity and provider-specific child detail", () => {
    const transcript = reduceEvents(
      fixture.events,
      fixture.sessionId,
      { replayMode: true },
    );
    const parent = transcript.itemsById[fixture.parentId] as ToolCallItem;

    expect(transcript.turnOrder).toEqual([fixture.turnId]);
    expect(transcript.turnsById[fixture.turnId]?.itemOrder).toEqual([
      fixture.parentId,
      ...fixture.childIds,
    ]);
    expect(parent).toMatchObject({
      kind: "tool_call",
      status: "completed",
      semanticKind: "subagent",
    });
    if (!fixture.parentTerminalBeforeTurnEnd) {
      const boundaryCompletionIndex = fixture.events.findIndex((envelope) =>
        envelope.itemId === fixture.parentId
        && envelope.event.type === "item_completed"
      );
      const beforeBoundary = reduceEvents(
        fixture.events.slice(0, boundaryCompletionIndex),
        fixture.sessionId,
        { replayMode: true },
      );
      expect(beforeBoundary.itemsById[fixture.parentId]?.status).toBe("in_progress");
    }
    expect(
      fixture.childIds.map((itemId) => transcript.itemsById[itemId]?.parentToolCallId),
    ).toEqual(fixture.childIds.map(() => fixture.parentId));

    const children = fixture.childIds.map((itemId) => transcript.itemsById[itemId]);
    if (fixture.provider === "claude") {
      expect(parent.nativeToolName).toBe("Task");
      expect(children.map((item) => item?.kind)).toEqual([
        "assistant_prose",
        "thought",
        "tool_call",
      ]);
    } else {
      expect(parent.nativeToolName).toBe("Agent");
      expect(children.map((item) => item?.kind)).toEqual(["tool_call"]);
      expect((children[0] as ToolCallItem).semanticKind).toBe("other");
      expect(Object.values(transcript.itemsById).some((item) =>
        item.kind === "assistant_prose" || item.kind === "thought"
      )).toBe(false);
    }
  });
});
