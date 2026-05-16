import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PLAYGROUND_END_TURN_DIFF_TRANSCRIPT,
  PLAYGROUND_PATCH_README,
} from "@/lib/domain/chat/__fixtures__/playground/git-diff-fixtures";
import { toolCallItem } from "@/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";
import { TurnDiffPanel } from "./TurnDiffPanel";

describe("TurnDiffPanel", () => {
  it("renders multi-file end-of-turn diffs with a clean aggregate header", () => {
    const turn = PLAYGROUND_END_TURN_DIFF_TRANSCRIPT.turnsById["turn-end-diff"];
    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn,
        transcript: PLAYGROUND_END_TURN_DIFF_TRANSCRIPT,
        onOpenFile: () => {},
      }),
    );

    expect(html).toContain("2 files changed");
    expect(html).not.toContain("+4");
    expect(html).not.toContain("text-git-red\">-2</span>");
    expect(html).toContain('text-right">+</span><span class="text-right">2');
    expect(html).toContain('text-right">-</span><span class="text-right">1');
    expect(html).toContain("grid-cols-[0.65ch_minmax(1ch,max-content)]");
    expect(html).toContain("data-diff-surface=\"chat\"");
    expect(html).toContain("README.md");
    expect(html).toContain("GitPanel.tsx");
  });

  it("labels the file card action as a changes review entry point", () => {
    const turn = PLAYGROUND_END_TURN_DIFF_TRANSCRIPT.turnsById["turn-end-diff"];
    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn,
        transcript: PLAYGROUND_END_TURN_DIFF_TRANSCRIPT,
        onOpenFile: () => {},
        onOpenReviewPane: () => {},
      }),
    );

    expect(html).toContain("Open changes review");
  });

  it("does not render chat diff cards for blank file patches", () => {
    const transcript = structuredClone(PLAYGROUND_END_TURN_DIFF_TRANSCRIPT);
    const readmeItem = transcript.itemsById["tool-end-diff-readme"] as {
      contentParts: Array<{ patch?: string }>;
    };
    const gitItem = transcript.itemsById["tool-end-diff-git"] as {
      contentParts: Array<{ patch?: string }>;
    };
    const readmePart = readmeItem.contentParts[0];
    const gitPart = gitItem.contentParts[0];
    readmePart.patch = "\n";
    gitPart.patch = "   ";

    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn: transcript.turnsById["turn-end-diff"],
        transcript,
        onOpenFile: () => {},
      }),
    );

    expect(html).toBe("");
  });

  it("shows only the first few file changes until expanded", () => {
    const transcript = structuredClone(PLAYGROUND_END_TURN_DIFF_TRANSCRIPT);
    const itemIds = Array.from({ length: 5 }, (_, index) => `tool-end-diff-extra-${index}`);
    transcript.turnsById["turn-end-diff"].itemOrder = ["assistant-end-diff", ...itemIds];
    for (const [index, itemId] of itemIds.entries()) {
      transcript.itemsById[itemId] = toolCallItem({
        itemId,
        toolCallId: itemId,
        turnId: "turn-end-diff",
        title: `Edit file-${index}.ts`,
        nativeToolName: "Edit",
        toolKind: "edit",
        semanticKind: "file_change",
        contentParts: [{
          type: "file_change",
          operation: "edit",
          path: `/Users/pablo/proliferate/src/file-${index}.ts`,
          workspacePath: `src/file-${index}.ts`,
          basename: `file-${index}.ts`,
          additions: 1,
          deletions: 1,
          patch: PLAYGROUND_PATCH_README,
        }],
      });
    }

    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn: transcript.turnsById["turn-end-diff"],
        transcript,
        onOpenFile: () => {},
      }),
    );

    expect(html).toContain("5 files changed");
    expect(html).toContain("src/file-0.ts");
    expect(html).toContain("src/file-2.ts");
    expect(html).not.toContain("src/file-3.ts");
    expect(html).toContain("Show 2 more");
  });
});
