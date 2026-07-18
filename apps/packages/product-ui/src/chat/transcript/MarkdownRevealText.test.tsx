// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

afterEach(cleanup);

describe("overlapping Markdown word reveal", () => {
  it("keeps several recent words independently animated", () => {
    const { container } = render(
      <MarkdownBody
        content="one **two** three"
        revealText
        revealedUpTo={0}
      />,
    );

    expect(
      Array.from(container.querySelectorAll(".stream-word"), (word) =>
        word.textContent
      ),
    ).toEqual(["one", "two", "three"]);
  });

  it("preserves existing word nodes while later words arrive", () => {
    const { container, rerender } = render(
      <MarkdownBody content="one two" revealText revealedUpTo={0} />,
    );
    const firstWord = Array.from(container.querySelectorAll(".stream-word"))
      .find((word) => word.textContent === "one");

    rerender(
      <MarkdownBody content="one two three" revealText revealedUpTo={0} />,
    );

    const firstWordAfterUpdate = Array.from(
      container.querySelectorAll(".stream-word"),
    ).find((word) => word.textContent === "one");
    expect(firstWordAfterUpdate).toBe(firstWord);
  });

  it("drops the animation only after a word leaves the fade window", () => {
    const { container } = render(
      <MarkdownBody
        content="one two three"
        revealText
        revealedUpTo={4}
      />,
    );

    const animatedWords = Array.from(
      container.querySelectorAll(".stream-word"),
      (word) => word.textContent,
    );
    expect(animatedWords).not.toContain("one");
    expect(animatedWords).toEqual(["two", "three"]);
    expect(container.textContent).toBe("one two three");
  });
});
