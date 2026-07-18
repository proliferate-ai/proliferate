// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_CHAT_COMPOSER_INPUT } from "#product/config/chat";
import { ChatInputDraftArea } from "#product/components/workspace/chat/input/ChatInputDraftArea";

vi.mock("#product/hooks/chat/ui/use-chat-draft-state", () => ({
  useChatDraftValue: () => ({ nodes: [] }),
}));
vi.mock("#product/components/workspace/chat/input/ComposerRichTextEditor", () => ({
  ComposerRichTextEditor: () => <div data-testid="queue-rich-editor" />,
}));
vi.mock("@proliferate/ui/primitives/ComposerTextareaFrame", () => ({
  ComposerTextareaFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("#product/components/workspace/chat/input/QueuedPromptEditBanner", () => ({
  QueuedPromptEditBanner: () => <div />,
}));

afterEach(cleanup);

describe("ChatInputDraftArea", () => {
  it("caps a queued rich editor at the workspace composer height", () => {
    render(
      <ChatInputDraftArea
        hasSessionTurns
        isEditingQueuedPrompt
        editingQueueSeq={7}
        editDraft="queued prompt"
        onEditDraftChange={vi.fn()}
        textareaRef={{ current: null }}
        workspaceUiKey={null}
        onDraftChange={vi.fn()}
        canSubmit
        isDisabled={false}
        onSubmit={vi.fn()}
        onKeyDown={vi.fn()}
        hasDraftAttachments={false}
        draftAttachments={[]}
        onRemoveDraftAttachment={vi.fn()}
        overlayHostElement={null}
        onCancelEdit={vi.fn()}
      />,
    );

    const viewport = screen.getByTestId("queue-rich-editor").parentElement!;
    expect(viewport.classList.contains("overflow-y-auto")).toBe(true);
    expect(viewport.style.minHeight).toBe(`${WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem}rem`);
    expect(viewport.style.maxHeight).toBe(
      `calc(var(--text-composer--line-height) * ${WORKSPACE_CHAT_COMPOSER_INPUT.maxRows})`,
    );
  });
});
