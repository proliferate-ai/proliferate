// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScratchCodeMirrorEditor } from "@/components/workspace/scratch/ScratchCodeMirrorEditor";

function collectStyleText() {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        rules.push(rule.cssText);
      }
    } catch {
      // Ignore cross-origin or opaque sheets; CodeMirror injects a readable local sheet.
    }
  }
  return rules.join("\n");
}

describe("ScratchCodeMirrorEditor", () => {

  it("keeps empty-state typography and caret sizing independent from diff styling", () => {
    render(
      <ScratchCodeMirrorEditor
        value=""
        placeholder="Write notes here"
        disabled={false}
        wordWrap
        onChange={vi.fn()}
        onBlur={vi.fn()}
      />,
    );

    const styleText = collectStyleText();

    expect(styleText).toContain("font-family: var(--scratch-font-family)");
    expect(styleText).toContain("font-size: var(--scratch-font-size)");
    expect(styleText).toContain("line-height: var(--scratch-line-height)");
    expect(styleText).toContain("white-space: normal");
    expect(styleText).toContain("height: 1.25em !important");
    expect(styleText).not.toContain("min-height: 1.1em");
  });
});
