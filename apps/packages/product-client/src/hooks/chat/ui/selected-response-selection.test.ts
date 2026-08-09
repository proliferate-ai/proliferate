// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  getSelectedAssistantResponse,
  isSelectedResponseInViewport,
} from "#product/hooks/chat/ui/selected-response-selection";

afterEach(() => {
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

describe("getSelectedAssistantResponse", () => {
  it("keeps an exact selection across links and code in one assistant response", () => {
    const root = transcriptRoot();
    const start = root.querySelector("[data-start]")!.firstChild!;
    const end = root.querySelector("code")!.firstChild!;
    const selection = selectRange(start, 0, end, end.textContent!.length);

    expect(getSelectedAssistantResponse(selection, root)).toEqual({
      text: "Alpha linked code",
      anchorRect: {
        x: 12,
        y: 24,
        width: 80,
        height: 18,
        top: 24,
        right: 92,
        bottom: 42,
        left: 12,
      },
    });
  });

  it("rejects selections that cross assistant responses", () => {
    const root = transcriptRoot();
    const responses = root.querySelectorAll("[data-assistant-prose]");
    const start = responses[0]!.querySelector("[data-start]")!.firstChild!;
    const end = responses[1]!.firstChild!;
    const selection = selectRange(start, 0, end, end.textContent!.length);

    expect(getSelectedAssistantResponse(selection, root)).toBeNull();
  });

  it("rejects selections that span ignored transcript controls", () => {
    const root = transcriptRoot();
    const start = root.querySelector("[data-start]")!.firstChild!;
    const end = root.querySelector("[data-end]")!.firstChild!;
    const selection = selectRange(start, 0, end, end.textContent!.length);

    expect(selection.toString()).toContain("Copy");
    expect(getSelectedAssistantResponse(selection, root)).toBeNull();
  });

  it("rejects user text, ignored controls, and collapsed selections", () => {
    const root = transcriptRoot();
    const userText = root.querySelector("[data-user]")!.firstChild!;
    expect(getSelectedAssistantResponse(
      selectRange(userText, 0, userText, userText.textContent!.length),
      root,
    )).toBeNull();

    const ignoredText = root.querySelector("[data-chat-transcript-ignore]")!.firstChild!;
    expect(getSelectedAssistantResponse(
      selectRange(ignoredText, 0, ignoredText, ignoredText.textContent!.length),
      root,
    )).toBeNull();

    const assistantText = root.querySelector("[data-start]")!.firstChild!;
    expect(getSelectedAssistantResponse(
      selectRange(assistantText, 2, assistantText, 2),
      root,
    )).toBeNull();
  });
});

describe("isSelectedResponseInViewport", () => {
  it("uses the nearest clipping scroll viewport as well as the window", () => {
    const viewport = document.createElement("div");
    viewport.style.overflowY = "auto";
    const root = document.createElement("div");
    viewport.append(root);
    document.body.append(viewport);
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => ({ top: 100, right: 500, bottom: 300, left: 100 }),
    });
    const selection = {
      text: "clipped response",
      anchorRect: {
        x: 120,
        y: 40,
        width: 100,
        height: 20,
        top: 40,
        right: 220,
        bottom: 60,
        left: 120,
      },
    };

    expect(isSelectedResponseInViewport(selection, root)).toBe(false);
    selection.anchorRect.y = 140;
    selection.anchorRect.top = 140;
    selection.anchorRect.bottom = 160;
    expect(isSelectedResponseInViewport(selection, root)).toBe(true);
  });
});

function transcriptRoot(): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = [
    '<div data-assistant-prose><span data-start>Alpha </span><a href="#details">linked</a> <code>code</code><button data-chat-transcript-ignore>Copy</button><span data-end> Omega</span></div>',
    "<div data-assistant-prose>Second response</div>",
    "<div data-user>User prompt</div>",
  ].join("");
  document.body.append(root);
  return root;
}

function selectRange(
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): Selection {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  Object.defineProperty(range, "getBoundingClientRect", {
    value: () => ({
      x: 12,
      y: 24,
      width: 80,
      height: 18,
      top: 24,
      right: 92,
      bottom: 42,
      left: 12,
    }),
  });
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}
