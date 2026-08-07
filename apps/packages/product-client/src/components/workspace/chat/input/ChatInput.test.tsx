// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "#product/components/workspace/chat/input/ChatInput";
import type { PromptAttachmentController } from "#product/hooks/chat/ui/use-chat-prompt-attachments";

const chatInputMocks = vi.hoisted(() => ({
  lexicalPaste: vi.fn(),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: unknown) => unknown) => selector({
    workspaceSelectionNonce: 0,
  }),
}));
vi.mock("#product/stores/chat/chat-input-store", () => ({
  useChatInputStore: (selector: (state: unknown) => unknown) => selector({
    focusRequestNonce: 0,
  }),
}));
vi.mock("#product/hooks/chat/derived/use-active-session-identity", () => ({
  useActiveSessionId: () => null,
  useActiveSessionCanCancelState: () => false,
  useActiveSessionRunningState: () => false,
}));
vi.mock("#product/hooks/chat/derived/use-chat-availability-state", () => ({
  useChatAvailabilityState: () => ({
    isDisabled: false,
    sendBlockedReason: null,
    areRuntimeControlsDisabled: false,
  }),
}));
vi.mock("#product/hooks/chat/ui/use-chat-composer-keyboard", () => ({
  useChatComposerKeyboard: () => ({ handleKeyDown: vi.fn() }),
}));
vi.mock("#product/hooks/chat/ui/use-chat-draft-state", () => ({
  useChatDraftControls: () => ({
    workspaceUiKey: null,
    materializedWorkspaceId: null,
    getDraft: () => ({ nodes: [] }),
    setDraft: vi.fn(),
    isEmpty: true,
  }),
}));
vi.mock("#product/hooks/chat/facade/use-chat-model-selector-state", () => ({
  useChatModelSelectorState: () => ({
    launchControls: [],
    launchAgentKind: null,
  }),
}));
vi.mock("#product/hooks/chat/workflows/use-chat-prompt-actions", () => ({
  useChatPromptActions: () => ({ handleSubmit: vi.fn(), handleCancel: vi.fn() }),
}));
vi.mock("#product/hooks/chat/ui/use-composer-submit-gate", () => ({
  useComposerSubmitGate: () => ({ isSubmitting: false, run: vi.fn() }),
}));
vi.mock("#product/hooks/chat/facade/use-chat-session-controls", () => ({
  useChatSessionControls: () => ({ agentKind: null, controls: [], modeControl: null }),
}));
vi.mock("#product/hooks/chat/ui/use-queued-prompt-edit", () => ({
  useQueuedPromptEdit: () => ({
    isEditing: false,
    editingSeq: null,
    editDraft: "",
    setEditDraftText: vi.fn(),
    cancelEdit: vi.fn(),
    commitEdit: vi.fn(),
  }),
  useEditLastQueuedPrompt: () => vi.fn(),
}));
vi.mock("#product/hooks/plans/facade/use-plan-draft-attachments", () => ({
  usePlanDraftAttachments: () => ({
    attachments: [],
    removePlan: vi.fn(),
    clearPlans: vi.fn(),
    blocks: [],
    contentParts: [],
    hasPlans: false,
  }),
}));
vi.mock("#product/hooks/chat/workflows/use-prompt-attachment-preview-actions", () => ({
  usePromptAttachmentPreviewActions: () => ({ openAttachmentPreview: vi.fn() }),
}));
vi.mock("#product/hooks/ui/debug/use-debug-render-count", () => ({
  useDebugRenderCount: () => {},
}));
vi.mock("#product/components/diagnostics/DebugProfiler", () => ({
  DebugProfiler: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("#product/components/workspace/chat/input/ChatInputControlRow", () => ({
  ChatInputControlRow: () => null,
}));
vi.mock(
  "#product/components/workspace/chat/input/workspace-status/ConnectedWorkspaceStatusComposerControl",
  () => ({ ConnectedWorkspaceStatusComposerControl: () => null }),
);
vi.mock("#product/components/workspace/chat/input/ChatInputDraftArea", () => ({
  ChatInputDraftArea: ({ textareaRef }: { textareaRef: { current: HTMLDivElement | null } }) => (
    <div
      ref={textareaRef}
      data-testid="mock-chat-editor"
      onPaste={(event) => {
        event.preventDefault();
        chatInputMocks.lexicalPaste(event.clipboardData.getData("text/plain"));
      }}
    />
  ),
}));

beforeEach(() => { chatInputMocks.lexicalPaste.mockReset(); });
afterEach(cleanup);

describe("ChatInput paste ownership", () => {
  it("claims mixed file and text payloads before the editor", () => {
    const attachments = createAttachments(true);
    render(
      <ChatInput
        attachments={attachments.controller}
        suppressActiveSessionState
        suppressAutoFocus
      />,
    );
    const file = new File(["image"], "capture.png", { type: "image/png" });
    const event = pasteEvent("clipboard fallback", [file]);

    fireEvent(screen.getByTestId("mock-chat-editor"), event);

    expect(event.defaultPrevented).toBe(true);
    expect(attachments.addFiles).toHaveBeenCalledOnce();
    expect(chatInputMocks.lexicalPaste).not.toHaveBeenCalled();
  });

  it("leaves mixed text available to the editor when attachments are disabled", () => {
    const attachments = createAttachments(false);
    render(
      <ChatInput
        attachments={attachments.controller}
        suppressActiveSessionState
        suppressAutoFocus
      />,
    );
    const event = pasteEvent("clipboard fallback", [
      new File(["image"], "capture.png", { type: "image/png" }),
    ]);

    fireEvent(screen.getByTestId("mock-chat-editor"), event);

    expect(attachments.addFiles).not.toHaveBeenCalled();
    expect(chatInputMocks.lexicalPaste).toHaveBeenCalledWith("clipboard fallback");
  });
});

function createAttachments(canAttachFiles: boolean) {
  const addFiles = vi.fn();
  return {
    addFiles,
    controller: {
      attachments: [],
      addFiles,
      addTextPaste: vi.fn(() => false),
      removeAttachment: vi.fn(),
      clearAttachments: vi.fn(),
      clearSubmittedAttachments: vi.fn(),
      snapshotForSubmit: vi.fn(() => []),
      hasAttachments: false,
      hasSupportedAttachments: false,
      canAttachFiles,
      supportsAttachments: canAttachFiles,
    } as PromptAttachmentController,
  };
}

function pasteEvent(text: string, files: File[]): ClipboardEvent {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      getData: (type: string) => type === "text/plain" ? text : "",
      types: ["Files", "text/plain"],
    },
  });
  return event;
}
