// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantMessage,
  MAX_STREAM_REVEAL_CHARACTERS_PER_SECOND,
  selectVisibleTarget,
  STREAM_REVEAL_COMMIT_INTERVAL_MS,
  STREAM_REVEAL_FADE_MS,
  STREAM_REVEAL_HANDOFF_DELAY_MS,
  STREAM_REVEAL_SETTLE_MS,
} from "./AssistantMessage";

let nextFrameId = 0;
let frameTimestamp = 0;
let pendingFrames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  nextFrameId = 0;
  frameTimestamp = 0;
  pendingFrames = new Map();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextFrameId;
    pendingFrames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    pendingFrames.delete(id);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function flushNextFrame() {
  const entry = pendingFrames.entries().next().value as
    | [number, FrameRequestCallback]
    | undefined;
  expect(entry).toBeDefined();
  const [id, callback] = entry!;
  pendingFrames.delete(id);
  frameTimestamp += 17;
  act(() => callback(frameTimestamp));
}

describe("AssistantMessage streaming reveal", () => {
  it("renders mounted history immediately without replaying it", () => {
    const content = "A previously loaded answer that must already be settled.";
    const { container } = render(<AssistantMessage content={content} />);

    expect(container.textContent).toBe(content);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("paces the first live chunk instead of mounting it as a visible jump", () => {
    const content = "The first live chunk should enter through the frontier.";
    const { container } = render(
      <AssistantMessage content={content} isStreaming />,
    );

    expect(container.textContent).toBe("");
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    flushNextFrame();
    expect(container.textContent?.length).toBeGreaterThan(0);
    expect(container.textContent?.length).toBeLessThan(content.length);
  });

  it("reveals one source-order prefix so the next line waits for the frontier", () => {
    const firstParagraph =
      "The first paragraph has enough text to remain visible on its own.";
    const secondParagraph = "Second line begins only after its reveal starts.";
    const content = `${firstParagraph}\n\n${secondParagraph}`;
    const { container, rerender } = render(
      <AssistantMessage content="" isStreaming />,
    );

    rerender(<AssistantMessage content={content} isStreaming />);
    expect(container.textContent).toBe("");

    flushNextFrame();
    expect(container.textContent).not.toContain("Second line");

    let safety = 0;
    while (!container.textContent?.includes("Second") && safety < 30) {
      flushNextFrame();
      safety += 1;
    }

    expect(container.textContent).toContain(firstParagraph);
    expect(container.textContent).toContain("Second");
    expect(
      container.querySelector('[data-streaming-reveal="active"]'),
    ).not.toBeNull();
    expect(container.textContent?.indexOf("Second")).toBeGreaterThan(
      container.textContent?.indexOf(firstParagraph) ?? -1,
    );
  });

  it("never snaps a large initial or reconnect delivery into view", () => {
    const content = "x".repeat(1_000);
    const { container, rerender } = render(
      <AssistantMessage content="" isStreaming />,
    );

    rerender(<AssistantMessage content={content} isStreaming />);
    expect(container.textContent).toBe("");

    for (let frame = 0; frame < 10; frame += 1) {
      flushNextFrame();
    }
    const elapsedMs = 16 + (9 * 17);
    const maximumVisible = Math.ceil(
      (elapsedMs * MAX_STREAM_REVEAL_CHARACTERS_PER_SECOND) / 1_000,
    );
    expect(container.textContent?.length).toBeLessThanOrEqual(maximumVisible);
  });

  it("rewinds a corrected stream to its common prefix instead of snapping", () => {
    const initial = "old answer that is still arriving";
    const { container, rerender } = render(
      <AssistantMessage content={initial} isStreaming />,
    );
    flushNextFrame();
    expect(container.textContent?.length).toBeGreaterThan(0);
    expect(container.textContent?.length).toBeLessThan(initial.length);
    expect(initial.startsWith(container.textContent ?? "")).toBe(true);

    const corrected = "new answer delivered as one large corrected batch";
    rerender(<AssistantMessage content={corrected} isStreaming />);
    expect(container.textContent).toBe("");

    flushNextFrame();
    expect(container.textContent?.length).toBeLessThan(corrected.length);
  });

  it("resumes a remounted reveal from the exact prior visible prefix", () => {
    const content = "A remounted transcript row must continue without a buffered phrase jump.";
    const firstRender = render(
      <AssistantMessage content={content} animateReveal />,
    );

    for (let frame = 0; frame < 4; frame += 1) {
      flushNextFrame();
    }
    const priorVisibleText = firstRender.container.textContent ?? "";
    expect(priorVisibleText.length).toBeGreaterThan(0);
    expect(priorVisibleText.length).toBeLessThan(content.length);
    firstRender.unmount();

    const resumedRender = render(
      <AssistantMessage
        content={content}
        animateReveal
        initialVisibleLength={priorVisibleText.length}
      />,
    );
    expect(resumedRender.container.textContent).toBe(priorVisibleText);
    expect(resumedRender.container.querySelectorAll(".stream-word")).toHaveLength(0);

    flushNextFrame();
    const maximumFirstFrameGrowth = Math.ceil(
      (16 * MAX_STREAM_REVEAL_CHARACTERS_PER_SECOND) / 1_000,
    );
    expect(
      (resumedRender.container.textContent?.length ?? 0) - priorVisibleText.length,
    ).toBeLessThanOrEqual(maximumFirstFrameGrowth);
  });

  it("never re-fades prose that settled before a paused stream resumes", () => {
    const settledContent = "one two";
    const { container, rerender } = render(
      <AssistantMessage content={settledContent} animateReveal={false} />,
    );

    rerender(
      <AssistantMessage
        content={`${settledContent} three four`}
        animateReveal
      />,
    );
    flushNextFrame();

    const animatedWords = Array.from(
      container.querySelectorAll(".stream-word"),
      (word) => word.textContent,
    );
    expect(animatedWords.length).toBeGreaterThan(0);
    expect(animatedWords).not.toContain("one");
    expect(animatedWords).not.toContain("two");
  });

  it("drains the complete answer at the capped rate when streaming ends", () => {
    vi.useFakeTimers();
    const content = "Final answer ".repeat(30);
    const { container, rerender } = render(
      <AssistantMessage content="" isStreaming />,
    );

    rerender(<AssistantMessage content={content} isStreaming />);
    flushNextFrame();
    expect(container.textContent?.length).toBeLessThan(content.length);

    rerender(<AssistantMessage content={content} isStreaming={false} />);
    expect(container.textContent?.length).toBeLessThan(content.length);
    expect(
      container.querySelector('[data-streaming-reveal="active"]'),
    ).not.toBeNull();

    let safety = 0;
    while ((container.textContent?.length ?? 0) < content.trimEnd().length && safety < 300) {
      flushNextFrame();
      safety += 1;
    }

    expect(container.textContent).toBe(content.trimEnd());
    expect(
      container.querySelector('[data-streaming-reveal="active"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-streaming-reveal="settling"]'),
    ).not.toBeNull();

    act(() => vi.advanceTimersByTime(STREAM_REVEAL_SETTLE_MS));
    expect(container.querySelector("[data-streaming-reveal]")).toBeNull();
  });

  it("paces even a short already-completed answer before reporting it settled", () => {
    vi.useFakeTimers();
    const onRevealStateChange = vi.fn();
    const content = "Done.";
    const { container } = render(
      <AssistantMessage
        content={content}
        animateReveal
        onRevealStateChange={onRevealStateChange}
      />,
    );

    expect(container.textContent).toBe("");
    expect(onRevealStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ complete: false, visibleLength: 0 }),
    );

    while ((container.textContent?.length ?? 0) < content.length) {
      flushNextFrame();
    }
    expect(container.textContent).toBe(content);
    expect(onRevealStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ complete: false, phase: "settling" }),
    );

    act(() => vi.advanceTimersByTime(STREAM_REVEAL_FADE_MS));
    expect(onRevealStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ complete: false, phase: "settling" }),
    );

    act(() => vi.advanceTimersByTime(STREAM_REVEAL_HANDOFF_DELAY_MS));
    expect(onRevealStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        complete: true,
        phase: "idle",
        visibleLength: content.length,
        targetLength: content.length,
      }),
    );
  });

  it("advances by a bounded prefix on each frame", () => {
    const content = "abcdefghijklmnopqrstuvwxyz";
    const first = selectVisibleTarget(content, 0, 3);
    const second = selectVisibleTarget(content, first.length, 2);

    expect(first).toBe("abc");
    expect(second).toBe("abcde");
    expect(content.startsWith(first)).toBe(true);
    expect(second.startsWith(first)).toBe(true);
  });

  it("keeps independent word fades alive long enough to overlap", () => {
    const cssPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../design/src/css/dom.css",
    );
    const css = readFileSync(cssPath, "utf8");
    const start = css.indexOf("/* ---- Streaming prose reveal ----");
    const end = css.indexOf("/* Thinking indicator", start);
    const section = css.slice(start, end);

    expect(section).toContain("@keyframes stream-word-in");
    expect(section).toContain(".stream-word");
    expect(section).toContain("animation: stream-word-in 320ms linear both");
    expect(section).toContain("from { opacity: 0.08; }");
    expect(section).not.toContain("mask-image");
    expect(STREAM_REVEAL_FADE_MS).toBe(320);
    expect(STREAM_REVEAL_SETTLE_MS).toBe(
      STREAM_REVEAL_FADE_MS + STREAM_REVEAL_HANDOFF_DELAY_MS,
    );
    expect(STREAM_REVEAL_COMMIT_INTERVAL_MS).toBe(32);
    expect(section).toContain("@media (prefers-reduced-motion: reduce)");

    const generatedCssPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../design/dist/css/dom.css",
    );
    if (existsSync(generatedCssPath)) {
      expect(readFileSync(generatedCssPath, "utf8")).toContain(
        "animation: stream-word-in 320ms linear both",
      );
    }
  });

  it("routes an incomplete streaming file link through the link renderer", () => {
    const renderLink = vi.fn(({ children }) => (
      <span data-rendered-file-link>{children}</span>
    ));
    const { container } = render(
      <AssistantMessage
        content="[config](/Users/pablo/.codex/conf"
        isStreaming
        renderLink={renderLink}
      />,
    );

    let safety = 0;
    while (
      !renderLink.mock.calls.some(
        ([input]) => input.href === "/Users/pablo/.codex/conf",
      ) &&
      safety < 40
    ) {
      flushNextFrame();
      safety += 1;
    }

    expect(renderLink).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/Users/pablo/.codex/conf" }),
    );
    expect(
      container.querySelector("[data-rendered-file-link]")?.textContent,
    ).toBe("config");
    expect(container.textContent).not.toContain("/Users/pablo");
  });
});
