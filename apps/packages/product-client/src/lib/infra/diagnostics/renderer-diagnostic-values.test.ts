import { describe, expect, it } from "vitest";

import {
  classifyRendererErrorClass,
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

describe("classifyRendererErrorClass", () => {
  it("classifies a bare TypeError as network — the only signal a rejected fetch gives", () => {
    expect(classifyRendererErrorClass(new TypeError("fetch failed"))).toBe("network");
  });

  it("classifies AbortError and SyntaxError from their name", () => {
    const abort = new Error("the operation was aborted");
    abort.name = "AbortError";
    expect(classifyRendererErrorClass(abort)).toBe("abort");

    expect(classifyRendererErrorClass(new SyntaxError("bad json"))).toBe("parse");
  });

  it("classifies a numeric status as http_status even when the name would otherwise resolve", () => {
    const httpError = Object.assign(new TypeError("request failed"), { status: 503 });
    expect(classifyRendererErrorClass(httpError)).toBe("http_status");

    const problemDetail = { name: "Error", problem: { status: 422 } };
    expect(classifyRendererErrorClass(problemDetail)).toBe("http_status");
  });

  it("never derives the class from the message text", () => {
    // The message spells out class names that do NOT match this error's actual
    // shape (name "Error", no numeric status) — classification must stay
    // "unknown", proving the message is never consulted.
    const misleading = new Error("network abort http_status parse");
    expect(classifyRendererErrorClass(misleading)).toBe("unknown");

    // Even a message identical to a real class name must not leak through
    // when the shape doesn't match it.
    const spoofed = new Error("abort");
    expect(classifyRendererErrorClass(spoofed)).toBe("unknown");
  });

  it("falls back to unknown for unrecognized shapes, primitives, and nullish values", () => {
    expect(classifyRendererErrorClass({})).toBe("unknown");
    expect(classifyRendererErrorClass("boom")).toBe("unknown");
    expect(classifyRendererErrorClass(42)).toBe("unknown");
    expect(classifyRendererErrorClass(null)).toBe("unknown");
    expect(classifyRendererErrorClass(undefined)).toBe("unknown");
  });
});
