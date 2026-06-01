import type { CloudPendingInteraction } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";

import {
  commandIdsKey,
  pendingPromptCommandIdsFromInteractions,
} from "./cloud-chat-command-tracking";

describe("cloud chat command tracking", () => {
  it("builds stable keys for recreated command id arrays with the same ids", () => {
    const pendingInteractions = [
      pendingPromptInteraction("older-command", 1),
      pendingPromptInteraction("newer-command", 2),
    ];

    const firstIds = pendingPromptCommandIdsFromInteractions(pendingInteractions);
    const recreatedIds = pendingPromptCommandIdsFromInteractions([...pendingInteractions]);

    expect(firstIds).not.toBe(recreatedIds);
    expect(firstIds).toEqual(["newer-command", "older-command"]);
    expect(commandIdsKey(firstIds)).toBe(commandIdsKey(recreatedIds));
  });

  it("keeps order changes visible in the command id key", () => {
    expect(commandIdsKey(["first", "second"])).not.toBe(commandIdsKey(["second", "first"]));
  });
});

function pendingPromptInteraction(commandId: string, requestedSeq: number): CloudPendingInteraction {
  return {
    requestId: commandId,
    kind: "send_prompt",
    status: "pending",
    requestedSeq,
    payload: { commandId },
  } as CloudPendingInteraction;
}
