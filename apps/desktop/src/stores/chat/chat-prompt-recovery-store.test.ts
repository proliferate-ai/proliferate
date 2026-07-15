import { beforeEach, describe, expect, it } from "vitest";
import {
  useChatPromptRecoveryStore,
  type ChatPromptRecovery,
} from "@/stores/chat/chat-prompt-recovery-store";
import {
  createPromptOutboxEntry,
} from "@proliferate/product-domain/sessions/intents/session-intent-model";

beforeEach(() => {
  useChatPromptRecoveryStore.getState().clear();
});

describe("chat prompt recovery store", () => {
  it("keeps distinct failed prompts scoped to their workspace shell", () => {
    const first = createRecovery("prompt-1", "first");
    const second = createRecovery("prompt-2", "second");

    useChatPromptRecoveryStore.getState().addRecoveries(
      "logical-workspace-1",
      [first, second],
    );

    expect(useChatPromptRecoveryStore.getState()
      .recoveriesByWorkspaceUiKey["logical-workspace-1"])
      .toEqual([first, second]);
    useChatPromptRecoveryStore.getState().removeRecovery(
      "logical-workspace-1",
      "prompt-1",
    );
    expect(useChatPromptRecoveryStore.getState()
      .recoveriesByWorkspaceUiKey["logical-workspace-1"]?.map((entry) => entry.id))
      .toEqual(["prompt-2"]);
  });
});

function createRecovery(id: string, text: string): ChatPromptRecovery {
  return {
    id,
    workspaceId: "workspace-1",
    agentKind: "claude",
    modelId: "sonnet",
    modeId: null,
    errorMessage: "Session creation failed.",
    prompt: createPromptOutboxEntry({
      clientPromptId: id,
      clientSessionId: "pending-claude",
      workspaceId: "workspace-1",
      text,
      blocks: [{ type: "text", text }],
    }),
  };
}
