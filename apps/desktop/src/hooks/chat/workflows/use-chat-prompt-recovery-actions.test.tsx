// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatPromptRecoveryActions } from "@/hooks/chat/workflows/use-chat-prompt-recovery-actions";
import {
  useChatPromptRecoveryStore,
  type ChatPromptRecovery,
} from "@/stores/chat/chat-prompt-recovery-store";
import { createPromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/hooks/sessions/workflows/use-session-creation-actions", () => ({
  useSessionCreationActions: () => ({
    createSessionWithResolvedConfig: mocks.createSession,
  }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof mocks.showToast }) => unknown) =>
    selector({ show: mocks.showToast }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createSession.mockResolvedValue("pending-retry");
  useChatPromptRecoveryStore.getState().clear();
});

describe("useChatPromptRecoveryActions", () => {
  it("retries only the selected recovery and leaves its siblings untouched", async () => {
    const first = createRecovery("prompt-1", "first");
    const second = createRecovery("prompt-2", "second");
    useChatPromptRecoveryStore.getState().addRecoveries("logical-1", [first, second]);
    const { result } = renderHook(() => useChatPromptRecoveryActions("logical-1"));

    await act(async () => {
      await expect(result.current.retryRecovery(first)).resolves.toBe(true);
    });

    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({
      text: "first",
      promptId: "prompt-1",
      agentKind: "claude",
      modelId: "sonnet",
    }));
    expect(useChatPromptRecoveryStore.getState()
      .recoveriesByWorkspaceUiKey["logical-1"]?.map((entry) => entry.id))
      .toEqual(["prompt-2"]);
  });
});

function createRecovery(id: string, text: string): ChatPromptRecovery {
  return {
    id,
    workspaceId: "workspace-1",
    agentKind: "claude",
    modelId: "sonnet",
    modeId: "agent",
    errorMessage: "Could not launch Claude.",
    prompt: createPromptOutboxEntry({
      clientPromptId: id,
      clientSessionId: "failed-replacement",
      workspaceId: "workspace-1",
      text,
      blocks: [{ type: "text", text }],
    }),
  };
}
