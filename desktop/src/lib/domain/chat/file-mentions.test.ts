import { describe, expect, it } from "vitest";
import {
  appendTextToDraft,
  collapseSelection,
  createFileMentionNode,
  createTextDraft,
  deleteBackwardAtSelection,
  deleteForwardAtSelection,
  findMentionTrigger,
  insertFileMentionAtTrigger,
  insertTextAtSelection,
  isChatDraftEmpty,
  positionFromLinearOffset,
  removeMentionAtIndex,
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
} from "./file-mentions";
import {
  formatMarkdownFileLink,
  isValidWorkspaceRelativePath,
  tokenizeSerializedFileLinks,
} from "./file-mention-links";

const mention = (id: string, path = "desktop/src/App.tsx") =>
  createFileMentionNode({ id, name: path.split("/").pop() ?? path, path });

describe("chat file mentions", () => {
  it("detects @ triggers at allowed boundaries", () => {
    const draft = createTextDraft("see @Cha");
    expect(findMentionTrigger(draft, positionFromLinearOffset(draft, 8))).toEqual({
      query: "Cha",
      start: { kind: "text", nodeIndex: 0, offset: 4 },
      end: { kind: "text", nodeIndex: 0, offset: 8 },
    });

    const afterNewline = createTextDraft("one\n@two");
    expect(findMentionTrigger(afterNewline, positionFromLinearOffset(afterNewline, 8))?.query)
      .toBe("two");

    const afterPunctuation = createTextDraft("(@file");
    expect(findMentionTrigger(afterPunctuation, positionFromLinearOffset(afterPunctuation, 6))?.query)
      .toBe("file");
  });

  it("does not trigger inside words and treats @fo@bar as one query", () => {
    const emailLike = createTextDraft("foo@bar");
    expect(findMentionTrigger(emailLike, positionFromLinearOffset(emailLike, 7))).toBeNull();

    const nested = createTextDraft("@fo@bar");
    expect(findMentionTrigger(nested, positionFromLinearOffset(nested, 7))?.query)
      .toBe("fo@bar");
  });

  it("detects @ after a mention boundary", () => {
    const draft: ChatComposerDraft = {
      nodes: [mention("a"), { type: "text", text: "@App" }],
    };

    expect(findMentionTrigger(draft, positionFromLinearOffset(draft, 5))?.query)
      .toBe("App");
  });

  it("inserts a file mention and returns the caret after the trailing space", () => {
    const draft = createTextDraft("open @App today");
    const trigger = findMentionTrigger(draft, positionFromLinearOffset(draft, 9));
    expect(trigger).not.toBeNull();

    const result = insertFileMentionAtTrigger(draft, trigger!, mention("a"));

    expect(result.draft.nodes).toEqual([
      { type: "text", text: "open " },
      { type: "file_mention", id: "a", name: "App.tsx", path: "desktop/src/App.tsx" },
      { type: "text", text: " today" },
    ]);
    expect(result.selection).toEqual(collapseSelection({ kind: "text", nodeIndex: 2, offset: 1 }));
  });

  it("keeps duplicate mentions of the same path distinct", () => {
    const draft: ChatComposerDraft = {
      nodes: [
        mention("a"),
        { type: "text", text: " " },
        mention("b"),
      ],
    };

    expect(draft.nodes[0]).toEqual({
      type: "file_mention",
      id: "a",
      name: "App.tsx",
      path: "desktop/src/App.tsx",
    });
    expect(draft.nodes[2]).toEqual({
      type: "file_mention",
      id: "b",
      name: "App.tsx",
      path: "desktop/src/App.tsx",
    });
  });

  it("removes mention atoms and restores the caret to the former badge position", () => {
    const draft: ChatComposerDraft = {
      nodes: [
        { type: "text", text: "A " },
        mention("a"),
        { type: "text", text: " B" },
      ],
    };

    const result = removeMentionAtIndex(draft, 1);

    expect(result.draft.nodes).toEqual([{ type: "text", text: "A  B" }]);
    expect(result.selection).toEqual(collapseSelection({ kind: "text", nodeIndex: 0, offset: 2 }));
  });

  it("backspace and delete remove adjacent mention atoms", () => {
    const draft: ChatComposerDraft = {
      nodes: [
        { type: "text", text: "A" },
        mention("a"),
        { type: "text", text: "B" },
      ],
    };

    expect(deleteBackwardAtSelection(
      draft,
      collapseSelection({ kind: "after-node", nodeIndex: 1 }),
    ).draft.nodes).toEqual([{ type: "text", text: "AB" }]);

    expect(deleteForwardAtSelection(
      draft,
      collapseSelection({ kind: "text", nodeIndex: 0, offset: 1 }),
    ).draft.nodes).toEqual([{ type: "text", text: "AB" }]);
  });

  it("coalesces appended and inserted adjacent text nodes", () => {
    const appended = appendTextToDraft({ nodes: [mention("a")] }, " now");
    expect(appended.draft.nodes).toEqual([
      { type: "file_mention", id: "a", name: "App.tsx", path: "desktop/src/App.tsx" },
      { type: "text", text: " now" },
    ]);

    const inserted = insertTextAtSelection(
      { nodes: [{ type: "text", text: "ab" }, { type: "text", text: "cd" }] },
      collapseSelection({ kind: "text", nodeIndex: 0, offset: 1 }),
      "X",
    );
    expect(inserted.draft.nodes).toEqual([{ type: "text", text: "aXbcd" }]);
  });

  it("serializes mentions without trimming the prompt", () => {
    const draft: ChatComposerDraft = {
      nodes: [
        { type: "text", text: "  see " },
        mention("a"),
        { type: "text", text: "  " },
      ],
    };

    expect(serializeChatDraftToPrompt(draft))
      .toBe("  see [App.tsx](desktop/src/App.tsx)  ");
  });

  it("escapes labels and paths and tokenizes the serialized result", () => {
    const link = formatMarkdownFileLink("a[b](c).tsx", "docs/file (copy).tsx");
    expect(link).toBe("[a\\[b\\](c).tsx](<docs/file (copy).tsx>)");

    expect(tokenizeSerializedFileLinks(`See ${link}`)).toEqual([
      { type: "text", text: "See " },
      {
        type: "file_link",
        raw: link,
        label: "a[b](c).tsx",
        path: "docs/file (copy).tsx",
      },
    ]);
  });

  it("rejects unsafe paths", () => {
    expect(isValidWorkspaceRelativePath("desktop/src/App.tsx")).toBe(true);
    expect(isValidWorkspaceRelativePath("./desktop/src/App.tsx")).toBe(true);
    expect(isValidWorkspaceRelativePath("../outside.ts")).toBe(false);
    expect(isValidWorkspaceRelativePath("/absolute.ts")).toBe(false);
    expect(isValidWorkspaceRelativePath("~/secret.ts")).toBe(false);
    expect(isValidWorkspaceRelativePath("C:\\repo\\file.ts")).toBe(false);
    expect(isValidWorkspaceRelativePath("https://example.com/file.ts")).toBe(false);
    expect(isValidWorkspaceRelativePath("#anchor")).toBe(false);
  });

  it("leaves arbitrary malformed or unsafe markdown links as text", () => {
    expect(tokenizeSerializedFileLinks("[external](https://example.com)")).toEqual([
      { type: "text", text: "[external](https://example.com)" },
    ]);
    expect(tokenizeSerializedFileLinks("[absolute](/tmp/file.ts)")).toEqual([
      { type: "text", text: "[absolute](/tmp/file.ts)" },
    ]);
    expect(tokenizeSerializedFileLinks("[bad](../outside.ts)")).toEqual([
      { type: "text", text: "[bad](../outside.ts)" },
    ]);
  });

  it("treats whitespace-only drafts as empty and mentions as content", () => {
    expect(isChatDraftEmpty(createTextDraft(" \n\t"))).toBe(true);
    expect(isChatDraftEmpty({ nodes: [mention("a")] })).toBe(false);
  });
});
