// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptRecoveryPanel } from "@/components/workspace/chat/input/PromptRecoveryPanel";
import type { ChatPromptRecovery } from "@/stores/chat/chat-prompt-recovery-store";
import { createPromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";

describe("PromptRecoveryPanel", () => {
  it("identifies each failed prompt and retries the chosen one", () => {
    const first = createRecovery("prompt-1", "Update the parser");
    const second = createRecovery("prompt-2", "Run the integration tests");
    const onRetry = vi.fn();

    render(
      <PromptRecoveryPanel
        recoveries={[first, second]}
        retryingId={null}
        onRetry={onRetry}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("Update the parser")).not.toBeNull();
    expect(screen.getByText("Run the integration tests")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Messages not sent" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", {
      name: "Retry unsent message: Run the integration tests",
    }));
    expect(onRetry).toHaveBeenCalledWith(second);
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
      clientSessionId: "failed-replacement",
      workspaceId: "workspace-1",
      text,
      blocks: [{ type: "text", text }],
    }),
  };
}
