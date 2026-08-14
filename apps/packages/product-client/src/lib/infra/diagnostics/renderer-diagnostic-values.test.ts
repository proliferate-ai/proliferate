import { describe, expect, it } from "vitest";

import {
  safeRendererErrorMessage,
  safeRendererErrorName,
} from "./renderer-diagnostic-values";

describe("renderer diagnostic error values", () => {
  it("recognizes standard Error prototype names", () => {
    expect(safeRendererErrorName(new Error("failed"))).toBe("Error");
    expect(safeRendererErrorName(new TypeError("failed"))).toBe("TypeError");
  });

  it("never executes custom name or message accessors", () => {
    let getterCalls = 0;
    class HostileError extends Error {
      get name(): string {
        getterCalls += 1;
        throw new Error("name getter executed");
      }

      get message(): string {
        getterCalls += 1;
        throw new Error("message getter executed");
      }
    }
    const error = Object.create(HostileError.prototype) as HostileError;

    expect(safeRendererErrorName(error)).toBe("Error");
    expect(safeRendererErrorMessage(error)).toBe("[no message]");
    expect(getterCalls).toBe(0);
  });

  it("contains hostile proxy descriptor and prototype traps", () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor trap");
      },
      getPrototypeOf() {
        throw new Error("prototype trap");
      },
    });

    expect(safeRendererErrorName(hostile)).toBe("unknown_error");
    expect(safeRendererErrorMessage(hostile)).toBe("[no message]");
  });
});
