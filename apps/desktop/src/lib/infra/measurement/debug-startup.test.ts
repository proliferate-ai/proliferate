import { describe, expect, it } from "vitest";

import { summarizeStartupError } from "./debug-startup";

describe("summarizeStartupError", () => {
  it.each([
    [new Error("ordinary"), "Error"],
    [new TypeError("typed"), "TypeError"],
  ])("preserves the built-in prototype name for %s", (error, expectedName) => {
    expect(summarizeStartupError(error)).toEqual({
      errorName: expectedName,
      errorMessage: error.message,
    });
  });

  it("does not execute hostile name or message accessors", () => {
    let getterCalls = 0;
    const error = {};
    for (const key of ["name", "message"]) {
      Object.defineProperty(error, key, {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("accessor executed");
        },
      });
    }

    expect(summarizeStartupError(error)).toEqual({
      errorName: "UnknownError",
      errorMessage: "[no message]",
    });
    expect(getterCalls).toBe(0);
  });
});
