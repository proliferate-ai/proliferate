import { describe, expect, it } from "vitest";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "./ChatColumn";

describe("chat column contract", () => {
  it("owns one ruled readable measure for every chat state", () => {
    expect(CHAT_COLUMN_CLASSNAME).toBe("mx-auto w-full max-w-transcript-readable");
    expect(CHAT_COLUMN_CLASSNAME).not.toContain("max-w-3xl");
    expect(CHAT_COLUMN_CLASSNAME).not.toContain("[");
    expect(CHAT_SURFACE_GUTTER_CLASSNAME).toBe("px-4");
  });
});
