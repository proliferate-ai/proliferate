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

function installRangeMeasurementStub() {
  if (!window.Range || typeof window.Range.prototype.getClientRects === "function") {
    return;
  }
  Object.defineProperty(window.Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

describe("ScratchCodeMirrorEditor", () => {

  it("keeps empty-state typography and uses CodeMirror cursor geometry", () => {
    installRangeMeasurementStub();

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
    expect(styleText).toContain("border-left-color: var(--color-foreground)");
    expect(styleText).not.toContain("height: 1em !important");
    expect(styleText).not.toContain("margin-top: 0.33em");
    expect(styleText).not.toContain("min-height: 1.1em");
  });
});
