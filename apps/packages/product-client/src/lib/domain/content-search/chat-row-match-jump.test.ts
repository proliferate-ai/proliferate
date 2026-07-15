// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  chatRowKeyFromUnitId,
  parseChatRowMatchId,
  scrollActiveChatRowMatchIntoView,
} from "./chat-row-match-jump";

describe("parseChatRowMatchId", () => {
  it("splits the trailing ordinal off a colon-heavy row key", () => {
    expect(parseChatRowMatchId("chatrow:turn:abc:block:content:2")).toEqual({
      rowUnitId: "chatrow:turn:abc:block:content",
      ordinal: 2,
    });
  });

  it("returns null for non-chat-row ids and malformed input", () => {
    expect(parseChatRowMatchId(null)).toBeNull();
    expect(parseChatRowMatchId("diff:foo:line:0:1")).toBeNull();
    expect(parseChatRowMatchId("chatrow:turn:abc:block:content:x")).toBeNull();
  });
});

describe("chatRowKeyFromUnitId", () => {
  it("strips the chatrow prefix", () => {
    expect(chatRowKeyFromUnitId("chatrow:turn:abc:block:content")).toBe(
      "turn:abc:block:content",
    );
  });
});

describe("scrollActiveChatRowMatchIntoView", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function seedMarks(rowUnitId: string, count: number) {
    const container = document.createElement("div");
    for (let index = 0; index < count; index += 1) {
      const mark = document.createElement("mark");
      mark.className = "codex-thread-find-match";
      mark.setAttribute("data-content-search-row", rowUnitId);
      mark.scrollIntoView = () => {};
      container.append(mark);
    }
    document.body.append(container);
    return container;
  }

  it("activates the mark at the given ordinal and clears the previous active", () => {
    const rowUnitId = "chatrow:turn:abc:block:content";
    const container = seedMarks(rowUnitId, 3);
    const marks = container.querySelectorAll("mark");
    marks[0].classList.add("codex-thread-find-active");

    expect(scrollActiveChatRowMatchIntoView({ rowUnitId, ordinal: 2 })).toBe(true);

    expect(marks[0].classList.contains("codex-thread-find-active")).toBe(false);
    expect(marks[2].classList.contains("codex-thread-find-active")).toBe(true);
  });

  it("clamps to the last painted mark when fewer are painted than counted", () => {
    const rowUnitId = "chatrow:turn:abc:block:content";
    const container = seedMarks(rowUnitId, 2);
    const marks = container.querySelectorAll("mark");

    expect(scrollActiveChatRowMatchIntoView({ rowUnitId, ordinal: 5 })).toBe(true);
    expect(marks[1].classList.contains("codex-thread-find-active")).toBe(true);
  });

  it("returns false when the row has no painted marks yet", () => {
    expect(
      scrollActiveChatRowMatchIntoView({
        rowUnitId: "chatrow:turn:missing:block:content",
        ordinal: 0,
      }),
    ).toBe(false);
  });
});
