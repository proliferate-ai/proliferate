import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { StreamingIndicator } from "@/components/workspace/chat/transcript/StreamingIndicator";

describe("ThinkingText", () => {
  it("renders static Thinking text with the shimmer class hook", () => {
    const html = renderToStaticMarkup(<ThinkingText />);

    expect(html).toContain("Thinking");
    expect(html).toContain("thinking-text");
    expect(html).toContain("data-thinking-text");
  });
});

describe("StreamingIndicator", () => {
  it("uses Thinking text without elapsed seconds or braille canaries", () => {
    const html = renderToStaticMarkup(
      <StreamingIndicator startedAt={new Date(Date.now() - 12_000).toISOString()} />,
    );

    expect(html).toContain("Thinking");
    expect(html).not.toContain("12s");
    expect(html).not.toContain("data-jank-canary=\"braille\"");
  });
});
