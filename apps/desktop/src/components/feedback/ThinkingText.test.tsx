import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { StreamingIndicator } from "@/components/workspace/chat/transcript/StreamingIndicator";

const testDir = dirname(fileURLToPath(import.meta.url));
const desktopCss = readFileSync(
  resolve(testDir, "../../../../packages/design/src/css/desktop.css"),
  "utf8",
);
const domCss = readFileSync(
  resolve(testDir, "../../../../packages/design/src/css/dom.css"),
  "utf8",
);

/** The gleam block (dom.css — shared with web): first keyframes to marker. */
function thinkingSection(): string {
  const start = domCss.indexOf("@keyframes thinking-band-sweep");
  const end = domCss.indexOf("/* ---- end thinking indicator ---- */");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return domCss.slice(start, end);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ThinkingText", () => {
  it("renders static Thinking text with the gleam class hook", () => {
    const html = renderToStaticMarkup(<ThinkingText />);

    expect(html).toContain("Thinking");
    expect(html).toContain("thinking-text");
    expect(html).toContain("data-thinking-text");
  });

  it("keeps the two-layer band architecture: an aria-hidden glyph copy", () => {
    const html = renderToStaticMarkup(<ThinkingText text="Searching" />);

    expect(html).toContain("thinking-text-band");
    expect(html).toContain("thinking-text-band-glyphs");
    // The label renders twice: base text + band glyph copy, hidden from AT.
    expect(html.match(/>Searching</g)).toHaveLength(2);
    expect(html).toContain('aria-hidden="true"');
  });

  it("resumes a remounted gleam from the shared motion epoch", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T12:00:02.300Z"));
    const motionOriginMs = Date.parse("2026-04-13T12:00:00.000Z");

    const firstMount = renderToStaticMarkup(
      <ThinkingText motionOriginMs={motionOriginMs} />,
    );
    expect(firstMount).toContain("--thinking-text-delay:-500ms");

    vi.advanceTimersByTime(400);
    const replacementMount = renderToStaticMarkup(
      <ThinkingText motionOriginMs={motionOriginMs} />,
    );
    expect(replacementMount).toContain("--thinking-text-delay:-900ms");
  });
});

describe("thinking gleam css contract", () => {
  it("sweeps smoothly — no steps() cadence anywhere in the block", () => {
    expect(thinkingSection()).not.toContain("steps(");
  });

  it("is inert on hover — no hover rules on the gleam", () => {
    expect(thinkingSection()).not.toContain(":hover");
    expect(domCss).not.toContain(".thinking-text:hover");
    expect(desktopCss).not.toContain(".thinking-text:hover");
  });

  it("keeps the duration/easing knobs", () => {
    const section = thinkingSection();
    expect(section).toContain("var(--thinking-text-duration");
    expect(section).toContain("var(--thinking-text-easing");
    expect(section.match(/animation-delay: var\(--thinking-text-delay, 0ms\)/g)).toHaveLength(2);
  });

  it("is a light gleam, not a dark band: reaches full foreground", () => {
    const section = thinkingSection();
    expect(section).toContain("color: var(--color-foreground)");
    // The old dark shadow band must not come back.
    expect(section).not.toContain("rgb(0 0 0");
  });

  it("stays compositor-only: keyframes animate transform, never background-position", () => {
    const section = thinkingSection();
    expect(section).toContain("transform: translateX");
    expect(section).not.toContain("background-position");
  });

  it("has no resurrected dead streaming css", () => {
    for (const css of [desktopCss, domCss]) {
      expect(css).not.toContain("streaming-fade");
      expect(css).not.toContain("streaming-tail-mask");
      expect(css).not.toContain("pulse-running");
      expect(css).not.toContain("pulse-dot");
    }
  });
});

describe("StreamingIndicator", () => {
  it("defaults to the agent-work label with no elapsed suffix under 10s", () => {
    const html = renderToStaticMarkup(
      <StreamingIndicator startedAt={new Date(Date.now() - 2_000).toISOString()} />,
    );

    expect(html).toContain("Thinking");
    // Below the 10s threshold: no elapsed suffix and no jank canary.
    expect(html).not.toContain("·");
    expect(html).not.toContain("data-jank-canary=\"braille\"");
  });

  it("appends an elapsed suffix once the wait passes 10s", () => {
    const html = renderToStaticMarkup(
      <StreamingIndicator startedAt={new Date(Date.now() - 34_000).toISOString()} />,
    );

    expect(html).toContain("Thinking");
    expect(html).toContain("34s");
    expect(html).toContain("tabular-nums");
  });

  it("threads a context label instead of the universal Thinking", () => {
    const html = renderToStaticMarkup(
      <StreamingIndicator label="Sending…" startedAt={null} />,
    );

    expect(html).toContain("Sending…");
    expect(html).not.toContain(">Thinking<");
    expect(html).not.toContain("·");
  });
});
