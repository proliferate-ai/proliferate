import { describe, expect, it } from "vitest";
import {
  MAX_FEED_CONTENT_CHARS,
  appendCappedFeedContent,
} from "@/hooks/activity/derived/feed-content-buffer";

describe("appendCappedFeedContent", () => {
  it("appends verbatim while under the cap", () => {
    expect(appendCappedFeedContent("ab", "cd")).toBe("abcd");
    expect(appendCappedFeedContent("", "hello")).toBe("hello");
  });

  it("keeps only the trailing window once the cap is exceeded", () => {
    const previous = "x".repeat(MAX_FEED_CONTENT_CHARS);
    const result = appendCappedFeedContent(previous, "yz");
    expect(result.length).toBe(MAX_FEED_CONTENT_CHARS);
    // Newest bytes are retained; the oldest are dropped.
    expect(result.endsWith("yz")).toBe(true);
    expect(result.startsWith("x")).toBe(true);
  });

  it("never grows unbounded across many appends", () => {
    let content = "";
    for (let i = 0; i < 5_000; i += 1) {
      content = appendCappedFeedContent(content, "a".repeat(1_000));
    }
    expect(content.length).toBe(MAX_FEED_CONTENT_CHARS);
  });
});
