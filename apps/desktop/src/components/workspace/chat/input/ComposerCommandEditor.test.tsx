// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTextDraft,
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
} from "@/lib/domain/chat/composer/file-mention-draft-model";
import type { SessionSlashCommandViewModel } from "@/lib/domain/chat/composer/session-slash-command-policy";
import { ComposerCommandEditor } from "./ComposerCommandEditor";

const slashCommandMock = vi.hoisted(() => ({
  commands: [] as SessionSlashCommandViewModel[],
  moveHighlight: vi.fn(),
  selectedCount: 0,
}));

vi.mock("@/hooks/chat/ui/use-chat-slash-command-menu", () => ({
  useChatSlashCommandMenu: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (command: SessionSlashCommandViewModel) => void;
  }) => ({
    commands: open ? slashCommandMock.commands : [],
    highlightedIndex: 0,
    listRef: { current: null },
    moveHighlight: slashCommandMock.moveHighlight,
    selectHighlighted: () => {
      slashCommandMock.selectedCount += 1;
      const first = slashCommandMock.commands[0];
      if (first) {
        onSelect(first);
      }
    },
    setRowRef: vi.fn(),
    handleRowMouseEnter: vi.fn(),
  }),
}));

function renderEditor({
  draft = createTextDraft("hello"),
  canSubmit = true,
  onSubmit = vi.fn(),
  onDraftChange = vi.fn(),
}: {
  draft?: ChatComposerDraft;
  canSubmit?: boolean;
  onSubmit?: () => void;
  onDraftChange?: (draft: ChatComposerDraft) => void;
} = {}) {
  render(
    <ComposerCommandEditor
      draft={draft}
      onDraftChange={onDraftChange}
      placeholder="Message"
      canSubmit={canSubmit}
      disabled={false}
      onSubmit={onSubmit}
      topInset="standard"
    />,
  );
  return {
    onSubmit,
    onDraftChange,
    textarea: screen.getByPlaceholderText("Message"),
  };
}

describe("ComposerCommandEditor", () => {

  beforeEach(() => {
    slashCommandMock.commands = [];
    slashCommandMock.moveHighlight.mockClear();
    slashCommandMock.selectedCount = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("prevents repeated raw Enter fallback without submitting", () => {
    const { textarea, onSubmit } = renderEditor();

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(false);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits on a non-repeated raw Enter fallback", () => {
    const { textarea, onSubmit } = renderEditor();

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: false })).toBe(false);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps Enter as slash command selection when a slash trigger is active", () => {
    slashCommandMock.commands = [createSlashCommand("review", "Review the current changes")];
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    const { textarea } = renderEditor({
      draft: createTextDraft("/rev"),
      onSubmit,
      onDraftChange,
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(false);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(slashCommandMock.selectedCount).toBe(1);
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(serializeChatDraftToPrompt(onDraftChange.mock.calls[0]?.[0])).toBe("/review ");
  });

  it("submits slash text when no slash command matches", () => {
    const { textarea, onSubmit, onDraftChange } = renderEditor({
      draft: createTextDraft("/unknown"),
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: false })).toBe(false);

    expect(slashCommandMock.selectedCount).toBe(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not treat @ text as a composer command trigger", () => {
    slashCommandMock.commands = [createSlashCommand("review", "Review the current changes")];
    const { textarea, onSubmit, onDraftChange } = renderEditor({
      draft: createTextDraft("Open @fi"),
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: false })).toBe(false);

    expect(slashCommandMock.selectedCount).toBe(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

function createSlashCommand(
  name: string,
  description: string,
): SessionSlashCommandViewModel {
  return {
    id: name,
    name,
    displayName: `/${name}`,
    description,
    inputHint: null,
    group: "Commands",
  };
}
