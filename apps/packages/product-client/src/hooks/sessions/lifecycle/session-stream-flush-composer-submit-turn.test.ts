import { beforeEach, describe, expect, it } from "vitest";
import type { TurnRecord } from "@anyharness/sdk";

import {
  clearComposerSubmitTargetTurn,
  resetComposerSubmitTurnTrackingForTest,
  resolveComposerSubmitTargetTurnId,
} from "./session-stream-flush-composer-submit-turn";
import { turnHasAssistantRenderableTranscriptContent } from "#product/domain/chats/pending-prompts/pending-prompts";

function turn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    turnId: "t",
    itemOrder: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    stopReason: null,
    fileBadges: [],
    ...overrides,
  };
}

describe("resolveComposerSubmitTargetTurnId", () => {
  beforeEach(() => {
    resetComposerSubmitTurnTrackingForTest();
  });

  it("binds to a genuinely new turn id that appears in a batch", () => {
    const before = { turnOrder: [], turnsById: {} };
    const after = { turnOrder: ["new-turn"], turnsById: { "new-turn": turn({ turnId: "new-turn" }) } };

    expect(resolveComposerSubmitTargetTurnId("s1", before, after)).toBe("new-turn");
  });

  it(
    "does not bind (and so cannot finish) on a gap-fill batch that completes an older turn " +
      "before the submitted turn has even started " +
      "(FINDING 1 regression: pre-fix, 'check turnOrder's last entry' would treat this older " +
      "turn -- which IS turnOrder's last entry at this point, since the new turn hasn't " +
      "started -- as the submitted turn and finish the flow on stale content)",
    () => {
      // At submit time, only the old turn exists; the submitted turn has not
      // started yet, so no new turn id has appeared. Nothing to bind.
      const beforeSubmit = {
        turnOrder: ["old-turn"],
        turnsById: { "old-turn": turn({ turnId: "old-turn" }) },
      };

      // Batch 1 (gap-fill / reconnect): completes the OLDER turn with
      // assistant content. old-turn is turnOrder's ONLY (and thus last)
      // entry -- the exact precondition the finding describes -- but it is
      // not a new turn id, so it must not become the bound target.
      const afterGapFill = {
        turnOrder: ["old-turn"],
        turnsById: {
          "old-turn": turn({ turnId: "old-turn", itemOrder: ["assistant-item"] }),
        },
      };
      expect(resolveComposerSubmitTargetTurnId("s1", beforeSubmit, afterGapFill)).toBeNull();

      // Batch 2: the submitted turn finally starts (still no content).
      const afterSubmitStarts = {
        turnOrder: ["old-turn", "new-turn"],
        turnsById: {
          ...afterGapFill.turnsById,
          "new-turn": turn({ turnId: "new-turn" }),
        },
      };
      const targetTurnId = resolveComposerSubmitTargetTurnId(
        "s1",
        afterGapFill,
        afterSubmitStarts,
      );
      expect(targetTurnId).toBe("new-turn");

      // The flow's finish check, evaluated against the correctly bound
      // target turn (not old-turn, which already has content), must not see
      // assistant content yet.
      expect(
        turnHasAssistantRenderableTranscriptContent(
          afterSubmitStarts.turnsById[targetTurnId!],
          { itemsById: {} } as never,
        ),
      ).toBe(false);
    },
  );

  it("clears the binding so a later submit on the same session starts unbound", () => {
    const before = { turnOrder: [], turnsById: {} };
    const after = { turnOrder: ["new-turn"], turnsById: { "new-turn": turn({ turnId: "new-turn" }) } };
    resolveComposerSubmitTargetTurnId("s1", before, after);

    clearComposerSubmitTargetTurn("s1");

    // No new turn ids show up in this batch, so with no binding left there is
    // nothing to resolve.
    expect(resolveComposerSubmitTargetTurnId("s1", after, after)).toBeNull();
  });

  it("rebinds to a fresh turn if a prior submit's binding was never cleared", () => {
    const before = { turnOrder: [], turnsById: {} };
    const afterFirst = {
      turnOrder: ["turn-1"],
      turnsById: { "turn-1": turn({ turnId: "turn-1" }) },
    };
    expect(resolveComposerSubmitTargetTurnId("s1", before, afterFirst)).toBe("turn-1");

    // A second submit's turn appears before the first ever finished/cleared
    // (e.g. the first flow was pruned as stale) -- rebind to the newer turn.
    const afterSecond = {
      turnOrder: ["turn-1", "turn-2"],
      turnsById: {
        "turn-1": turn({ turnId: "turn-1" }),
        "turn-2": turn({ turnId: "turn-2" }),
      },
    };
    expect(resolveComposerSubmitTargetTurnId("s1", afterFirst, afterSecond)).toBe("turn-2");
  });
});
