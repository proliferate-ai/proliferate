import { describe, expect, it } from "vitest";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "./ChatColumn";

describe("chat column contract", () => {
  it("owns one ruled thread measure for every chat state", () => {
    // Two-tier measure: the shared column widens to the 48rem
    // --container-transcript-thread token; the 40rem readable cap moved onto
    // the prose elements themselves (MarkdownBody's PROSE_MEASURE_CLASSNAME).
    expect(CHAT_COLUMN_CLASSNAME).toBe("mx-auto w-full max-w-transcript-thread");
    expect(CHAT_COLUMN_CLASSNAME).not.toContain("max-w-3xl");
    expect(CHAT_COLUMN_CLASSNAME).not.toContain("[");
    expect(CHAT_SURFACE_GUTTER_CLASSNAME).toBe("px-4");
  });
});
