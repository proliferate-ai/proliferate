import { describe, expect, it } from "vitest";
import { stabilizeStreamingMarkdown } from "./streaming-markdown";

describe("stabilizeStreamingMarkdown", () => {
  it.each([
    ["[config](/Users/pablo/.codex/conf", "[config](/Users/pablo/.codex/conf)"],
    [
      "[config](file:///Users/pablo/.codex/conf",
      "[config](file:///Users/pablo/.codex/conf)",
    ],
    ["[config](../.codex/conf", "[config](../.codex/conf)"],
    [
      "[config](<file:///Users/pablo/My%20Project/conf",
      "[config](<file:///Users/pablo/My%20Project/conf>)",
    ],
    [
      "[config](<file:///Users/pablo/My%20Project/conf>",
      "[config](<file:///Users/pablo/My%20Project/conf>)",
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
});
