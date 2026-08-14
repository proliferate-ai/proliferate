// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { clearContextualWordSelection } from "#product/lib/infra/dom/contextual-word-selection";

function selectContents(element: Element) {
  const selection = window.getSelection();
  if (!selection) throw new Error("jsdom selection unavailable");
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("clearContextualWordSelection", () => {
  it("clears a selection inside the container", () => {
    document.body.innerHTML = "<button><span>notes.md</span></button>";
    const button = document.querySelector("button")!;
    const selection = selectContents(button.firstElementChild!);
    expect(selection.isCollapsed).toBe(false);

    clearContextualWordSelection(button);

    expect(selection.rangeCount).toBe(0);
  });

  it("leaves a selection made elsewhere alone", () => {
    document.body.innerHTML = "<p>prose the user selected</p><button>notes.md</button>";
    const selection = selectContents(document.querySelector("p")!);

    clearContextualWordSelection(document.querySelector("button")!);

    expect(selection.isCollapsed).toBe(false);
  });

  it("tolerates no selection and non-element targets", () => {
    document.body.innerHTML = "<button>notes.md</button>";
    expect(() => clearContextualWordSelection(document.querySelector("button")!)).not.toThrow();
    expect(() => clearContextualWordSelection(null)).not.toThrow();
    expect(() => clearContextualWordSelection(window)).not.toThrow();
  });
});
