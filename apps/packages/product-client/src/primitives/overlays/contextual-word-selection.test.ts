// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { clearContextualWordSelection } from "#product/primitives/overlays/contextual-word-selection";

function selectContents(element: Element) {
  const selection = window.getSelection();
  if (!selection) throw new Error("jsdom selection unavailable");
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function selectAcross(start: Element, end: Element) {
  const selection = window.getSelection();
  if (!selection) throw new Error("jsdom selection unavailable");
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, end.childNodes.length);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("clearContextualWordSelection", () => {
  it("clears a selection fully inside the container", () => {
    document.body.innerHTML = "<button><span>notes.md</span></button>";
    const button = document.querySelector("button")!;
    const selection = selectContents(button.firstElementChild!);
    expect(selection.isCollapsed).toBe(false);

    clearContextualWordSelection(button);

    expect(selection.rangeCount).toBe(0);
  });

  it("clears a selection whose endpoint is a descendant of the container", () => {
    document.body.innerHTML = "<button><span><em>notes.md</em></span></button>";
    const button = document.querySelector("button")!;
    selectContents(button.querySelector("em")!);

    clearContextualWordSelection(button);

    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it("leaves a selection made entirely elsewhere alone", () => {
    document.body.innerHTML = "<p>prose the user selected</p><button>notes.md</button>";
    const selection = selectContents(document.querySelector("p")!);

    clearContextualWordSelection(document.querySelector("button")!);

    expect(selection.isCollapsed).toBe(false);
    expect(selection.rangeCount).toBe(1);
  });

  it("preserves a deliberate selection with one endpoint outside the container", () => {
    document.body.innerHTML = "<p>before</p><button>notes.md</button>";
    const paragraph = document.querySelector("p")!;
    const button = document.querySelector("button")!;
    const selection = selectAcross(paragraph, button);
    expect(selection.isCollapsed).toBe(false);

    clearContextualWordSelection(button);

    expect(selection.rangeCount).toBe(1);
  });

  it("no-ops for a collapsed selection", () => {
    document.body.innerHTML = "<button>notes.md</button>";
    const button = document.querySelector("button")!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(button);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.isCollapsed).toBe(true);

    clearContextualWordSelection(button);

    expect(selection.rangeCount).toBe(1);
  });

  it("tolerates no selection and non-element targets", () => {
    document.body.innerHTML = "<button>notes.md</button>";
    expect(() => clearContextualWordSelection(document.querySelector("button")!)).not.toThrow();
    expect(() => clearContextualWordSelection(null)).not.toThrow();
    expect(() => clearContextualWordSelection(window)).not.toThrow();
  });
});
