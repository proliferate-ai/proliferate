import { describe, expect, it } from "vitest";
import {
  readToastPayload,
  toastOverflowLabel,
  TOAST_EXCERPT_MAX_LINES,
} from "#product/primitives/utils/toast-payload";

/**
 * The excerpt test. These cases are the rule itself, not samples of it: what
 * may appear inline in a toast is exactly a countable list, and everything else
 * is a blob that has to go behind Details.
 */
describe("readToastPayload", () => {
  it("renders a countable list of field errors inline", () => {
    const reading = readToastPayload(
      "steps[0].name is required\nsteps[2].timeout must be <= 3600",
    );

    expect(reading.blob).toBe(false);
    expect(reading.lines).toEqual([
      "steps[0].name is required",
      "steps[2].timeout must be <= 3600",
    ]);
    expect(reading.overflow).toBe(0);
  });

  it("caps the excerpt at three lines and counts the rest", () => {
    const reading = readToastPayload(
      ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].join("\n"),
    );

    expect(reading.lines).toHaveLength(TOAST_EXCERPT_MAX_LINES);
    expect(reading.overflow).toBe(2);
    expect(toastOverflowLabel(reading.overflow)).toBe("+2 more");
  });

  it("returns no inline lines for a stack trace, so one cannot be rendered", () => {
    const reading = readToastPayload(
      [
        "TypeError: cannot read properties of undefined",
        "    at resolveStep (workflow.ts:41:12)",
        "    at runWorkflow (workflow.ts:88:3)",
      ].join("\n"),
    );

    expect(reading.blob).toBe(true);
    // The guarantee is structural: `lines` is empty, so `ToastExcerpt` has
    // nothing to draw even if a caller passed the payload anyway.
    expect(reading.lines).toEqual([]);
    expect(reading.firstSentence).toBe(
      "TypeError: cannot read properties of undefined",
    );
  });

  it("treats prose as a blob and keeps only its first sentence", () => {
    const reading = readToastPayload(
      "The workflow could not start because the runtime never became ready. "
      + "We retried three times before giving up.",
    );

    expect(reading.blob).toBe(true);
    expect(reading.lines).toEqual([]);
    expect(reading.firstSentence).toBe(
      "The workflow could not start because the runtime never became ready.",
    );
  });

  it("treats a JSON body as a blob", () => {
    expect(readToastPayload('{"error":"nope"}').blob).toBe(true);
  });

  it("treats an over-long single line as a blob rather than truncating it", () => {
    expect(readToastPayload("x".repeat(400)).blob).toBe(true);
  });

  it("reads an empty payload as nothing to show, not as a blob", () => {
    const reading = readToastPayload("   \n  ");

    expect(reading.blob).toBe(false);
    expect(reading.lines).toEqual([]);
  });

  it("has no overflow label when nothing overflowed", () => {
    expect(toastOverflowLabel(0)).toBeNull();
  });
});
