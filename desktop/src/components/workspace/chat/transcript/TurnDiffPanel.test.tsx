import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLAYGROUND_END_TURN_DIFF_TRANSCRIPT } from "@/lib/domain/chat/__fixtures__/playground/git-diff-fixtures";
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
    expect(html).toContain("+2");
    expect(html).toContain("-1");
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
});
