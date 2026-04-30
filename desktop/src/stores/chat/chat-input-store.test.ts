import { beforeEach, describe, expect, it } from "vitest";
import {
  createFileMentionNode,
  serializeChatDraftToPrompt,
} from "@/lib/domain/chat/file-mentions";
import { useChatInputStore } from "./chat-input-store";

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

  it("stores structured drafts and preserves duplicate mention ids", () => {
    useChatInputStore.getState().setDraft("workspace-1", {
      nodes: [
        createFileMentionNode({
          id: "mention-a",
          name: "App.tsx",
          path: "desktop/src/App.tsx",
        }),
        { type: "text", text: " " },
        createFileMentionNode({
          id: "mention-b",
          name: "App.tsx",
          path: "desktop/src/App.tsx",
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
          path: "desktop/src/App.tsx",
        }),
      ],
    });
    useChatInputStore.getState().appendDraftText("workspace-1", " now");

    expect(serializeChatDraftToPrompt(
      useChatInputStore.getState().draftByWorkspaceId["workspace-1"]!,
    )).toBe("[App.tsx](desktop/src/App.tsx) now");

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
});
