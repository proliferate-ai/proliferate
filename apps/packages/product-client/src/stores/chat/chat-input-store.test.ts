import { beforeEach, describe, expect, it } from "vitest";
import {
  createFileMentionNode,
  createTextDraft,
  serializeChatDraftToPrompt,
} from "#product/lib/domain/chat/composer/file-mention-draft-model";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";

describe("chat input store", () => {
  beforeEach(() => {
    useChatInputStore.setState({
      draftByWorkspaceId: {},
      editDraftBySessionId: {},
      editingQueueSeqBySessionId: {},
      focusRequestNonce: 0,
    });
  });

  it("stores plain text drafts through the compatibility setter", () => {
    useChatInputStore.getState().setDraftText("workspace-1", "hello");

    expect(serializeChatDraftToPrompt(
      useChatInputStore.getState().draftByWorkspaceId["workspace-1"]!,
    )).toBe("hello");
  });

  it("preserves an opaque editor snapshot across clear and draft restoration", () => {
    const snapshot = { version: 1 as const, payload: '{"root":{"children":[]}}' };
    const draft = createTextDraft("[Docs](https://example.com)", snapshot);

    useChatInputStore.getState().setDraft("workspace-1", draft);
    useChatInputStore.getState().clearDraft("workspace-1");
    useChatInputStore.getState().setDraft("workspace-1", draft);

    expect(useChatInputStore.getState().draftByWorkspaceId["workspace-1"]?.editorSnapshot)
      .toEqual(snapshot);
    useChatInputStore.getState().setDraftText("workspace-1", "externally replaced");
    expect(useChatInputStore.getState().draftByWorkspaceId["workspace-1"]?.editorSnapshot)
      .toBeUndefined();
  });

  it("stores structured drafts and preserves duplicate mention ids", () => {
    useChatInputStore.getState().setDraft("workspace-1", {
      nodes: [
        createFileMentionNode({
          id: "mention-a",
          name: "App.tsx",
          path: "apps/desktop/src/App.tsx",
        }),
        { type: "text", text: " " },
        createFileMentionNode({
          id: "mention-b",
          name: "App.tsx",
          path: "apps/desktop/src/App.tsx",
        }),
      ],
    });

    expect(useChatInputStore.getState().draftByWorkspaceId["workspace-1"]?.nodes)
      .toHaveLength(3);
  });

  it("appends text and clears empty drafts", () => {
    useChatInputStore.getState().setDraft("workspace-1", {
      nodes: [
        createFileMentionNode({
          id: "mention-a",
          name: "App.tsx",
          path: "apps/desktop/src/App.tsx",
        }),
      ],
    });
    useChatInputStore.getState().appendDraftText("workspace-1", " now");

    expect(serializeChatDraftToPrompt(
      useChatInputStore.getState().draftByWorkspaceId["workspace-1"]!,
    )).toBe("[App.tsx](apps/desktop/src/App.tsx) now");

    useChatInputStore.getState().setDraftText("workspace-1", " \n ");
    expect(useChatInputStore.getState().draftByWorkspaceId["workspace-1"]).toBeUndefined();
  });

  it("tracks explicit composer focus requests", () => {
    useChatInputStore.getState().setDraftText("workspace-1", "hello");

    useChatInputStore.getState().requestFocus();
    useChatInputStore.getState().requestFocus();

    expect(useChatInputStore.getState().focusRequestNonce).toBe(2);
    expect(serializeChatDraftToPrompt(
      useChatInputStore.getState().draftByWorkspaceId["workspace-1"]!,
    )).toBe("hello");
  });

  it("tracks queued-message edits by stable queue seq", () => {
    useChatInputStore.getState().setEditingQueueSeq("session-1", 42);
    expect(
      useChatInputStore.getState().editingQueueSeqBySessionId["session-1"],
    ).toBe(42);

    useChatInputStore.getState().setEditingQueueSeq("session-1", null);
    expect(
      useChatInputStore.getState().editingQueueSeqBySessionId["session-1"],
    ).toBeUndefined();
  });
});
