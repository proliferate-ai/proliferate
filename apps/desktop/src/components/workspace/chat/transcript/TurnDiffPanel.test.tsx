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

    expect(html).toContain("Edited 2 files");
    expect(html).toContain("bg-[var(--color-diff-panel-surface)]");
    expect(html).toContain("data-chat-diff-wrap-context-trigger=\"turn-header\"");
    expect(html).toContain("bg-[var(--color-diff-chat-turn-header-surface)]");
    expect(html).toContain("hover:bg-[var(--color-diff-chat-turn-header-hover-surface)]");
    expect(html).toContain("bg-[var(--color-diff-chat-turn-icon-surface)]");
    expect(html).toContain("border border-border");
    expect(html).toContain(">+2</span>");
    expect(html).toContain(">-1</span>");
    expect(html).toContain("data-diff-surface=\"chat\"");
    expect(html).toContain("thread-diff-virtualized");
    expect(html).toContain("data-app-action-review-file-expanded=\"false\"");
    expect(html).not.toContain("data-gutter=\"\"");
    expect(html).not.toContain("data-content=\"\"");
    expect(html).toContain("README.md");
    expect(html).toContain("GitPanel.tsx");
  });

  it("renders visible aggregate review and undo actions while file rows keep their action", () => {
    const turn = PLAYGROUND_END_TURN_DIFF_TRANSCRIPT.turnsById["turn-end-diff"];
    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn,
        transcript: PLAYGROUND_END_TURN_DIFF_TRANSCRIPT,
        onOpenFile: () => {},
        onOpenReviewPane: () => {},
        onUndoTurnChanges: () => {},
      }),
    );

    expect(html).not.toContain("Open changes review");
    expect(html).toContain(">Review</button>");
    expect(html).toContain(">Undo</button>");
    expect(html).toContain("Review changes");
    expect(html).toContain("Show file in review");
    expect(html).toContain("data-app-action-review-file-toggle");
  });

  it("uses file-specific single-file end-turn copy without repeating row stats", () => {
    const transcript = structuredClone(PLAYGROUND_END_TURN_DIFF_TRANSCRIPT);
    transcript.turnsById["turn-end-diff"].itemOrder = [
      "assistant-end-diff",
      "tool-end-diff-readme",
    ];
    transcript.turnsById["turn-end-diff"].fileBadges = [
      { path: "README.md", additions: 2, deletions: 1 },
    ];

    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn: transcript.turnsById["turn-end-diff"],
        transcript,
        onOpenFile: () => {},
        onOpenReviewPane: () => {},
      }),
    );

    expect(html).toContain("Edited README.md");
    expect(html).not.toContain("Edited 1 file");
    expect(html).toContain(">Details</span>");
    expect(html.match(/>\+2<\/span>/g)).toHaveLength(1);
    expect(html.match(/>-1<\/span>/g)).toHaveLength(1);
    expect(html).toContain("data-app-action-review-file-expanded=\"false\"");
    expect(html).not.toContain("data-gutter=\"\"");
    expect(html).not.toContain("data-content=\"\"");
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

    expect(html).toContain("Edited 5 files");
    expect(html).toContain("src/file-0.ts");
    expect(html).toContain("src/file-2.ts");
    expect(html).not.toContain("src/file-3.ts");
    expect(html).toContain("Show 2 more files");
  });
});
