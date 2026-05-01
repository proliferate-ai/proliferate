import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLAYGROUND_END_TURN_DIFF_TRANSCRIPT } from "@/lib/domain/chat/__fixtures__/playground";
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
});
