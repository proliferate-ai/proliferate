// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

describe("MarkdownRevealText blip prevention", () => {
  afterEach(cleanup);

  it("words before revealedUpTo render without stream-word class", () => {
    // Simulate: first render had "some **bo" (incomplete bold), second render
    // has "some **bold** more" (completed bold). The first 9 characters
    // ("some **bo") were already shown, so after the stable/live split those
    // words must not re-animate.
    const content = "some **bold** more";
    // revealedUpTo = 9 means characters 0..8 were already rendered.
    const { container } = render(
      <MarkdownBody
        content={content}
        revealText={true}
        revealedUpTo={9}
      />,
    );

    const streamWords = container.querySelectorAll(".stream-word");
    const allSpans = container.querySelectorAll("span");

    // "more" should be animated (it's new text past offset 9).
    const animatedTexts = Array.from(streamWords).map((el) => el.textContent);
    expect(animatedTexts).toContain("more");

    // "some" should NOT have stream-word class (it was already revealed).
    const someSpan = Array.from(allSpans).find((el) => el.textContent === "some");
    expect(someSpan).toBeTruthy();
    expect(someSpan!.classList.contains("stream-word")).toBe(false);
  });

  it("with revealedUpTo=0 all words animate (first render)", () => {
    const content = "hello world";
    const { container } = render(
      <MarkdownBody
        content={content}
        revealText={true}
        revealedUpTo={0}
      />,
    );

    const streamWords = container.querySelectorAll(".stream-word");
    const texts = Array.from(streamWords).map((el) => el.textContent);
    expect(texts).toContain("hello");
    expect(texts).toContain("world");
  });

  it("with revealText=false no words get stream-word class", () => {
    const content = "hello world";
    const { container } = render(
      <MarkdownBody
        content={content}
        revealText={false}
      />,
    );

    const streamWords = container.querySelectorAll(".stream-word");
    expect(streamWords.length).toBe(0);
  });

  it("structure change from plain to bold does not re-animate settled words", () => {
    // First render: "Check this bo" (no bold yet, 13 chars)
    // Second render: "Check this **bold** end" (bold completed)
    // revealedUpTo=13 means first 13 chars were rendered previously.
    const content = "Check this **bold** end";
    const { container } = render(
      <MarkdownBody
        content={content}
        revealText={true}
        revealedUpTo={13}
      />,
    );

    const streamWords = container.querySelectorAll(".stream-word");
    const animatedTexts = Array.from(streamWords).map((el) => el.textContent);

    // "Check" and "this" should NOT be animated — they were settled.
    expect(animatedTexts).not.toContain("Check");
    expect(animatedTexts).not.toContain("this");

    // "end" is new text and should be animated.
    expect(animatedTexts).toContain("end");
  });

  it("fully settled element renders children as plain text (no spans)", () => {
    // Content is 11 chars; revealedUpTo > content length means everything settled.
    const content = "hello world";
    const { container } = render(
      <MarkdownBody
        content={content}
        revealText={true}
        revealedUpTo={100}
      />,
    );

    const spans = container.querySelectorAll("span");
    // No word spans at all — children rendered as plain text.
    expect(spans.length).toBe(0);
  });
});
