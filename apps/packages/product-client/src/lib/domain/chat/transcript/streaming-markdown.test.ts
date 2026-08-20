import { describe, expect, it } from "vitest";
import { stabilizeStreamingMarkdown } from "./streaming-markdown";

describe("stabilizeStreamingMarkdown", () => {
  it.each([
    ["[config](/Users/pablo/.codex/conf", "[config](/Users/pablo/.codex/conf)"],
    ["[config](../.codex/conf", "[config](../.codex/conf)"],
    ["[config](~/.codex/conf", "[config](~/.codex/conf)"],
    ["[config](./conf", "[config](./conf)"],
    [
      "[config](</Users/pablo/My Project/conf",
      "[config](</Users/pablo/My Project/conf>)",
    ],
    ["[config](C:\\Users\\pablo\\conf", "[config](C:\\Users\\pablo\\conf)"],
  ])("temporarily closes an incomplete local-file link", (input, expected) => {
    expect(stabilizeStreamingMarkdown(input)).toBe(expected);
  });

  it.each([
    "[site](https://example.com/part",
    "[asset](//cdn.example.com/part",
    "![preview](/Users/pablo/image.png",
    "[config](/Users/pablo/.codex/config.toml)",
    "plain [unfinished label",
  ])("leaves non-target markdown untouched", (content) => {
    expect(stabilizeStreamingMarkdown(content)).toBe(content);
  });

  it.each([
    "[config](file:///Users/pablo/.codex/conf",
    "[config](<file:///Users/pablo/My%20Project/conf",
    "[config](<file:///Users/pablo/My%20Project/conf>",
  ])("no longer stabilizes a file: destination", (content) => {
    // Intentional contract change from the previous behaviour, which closed
    // `file:` tails. A scheme is an authority grant rather than a local path,
    // so every scheme — `file:` included — is now excluded from stabilization
    // and from local-link repair. Only the exact drive-root colon form is
    // treated as path syntax.
    expect(stabilizeStreamingMarkdown(content)).toBe(content);
  });
});
