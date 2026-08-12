import { describe, expect, it, vi } from "vitest";

import { normalizeOwnQueryParameter } from "./query.js";

describe("normalizeOwnQueryParameter", () => {
  it("normalizes own string and safe-integer data properties", () => {
    const input = {
      mode: "recent",
      limit: 3,
    };

    expect(normalizeOwnQueryParameter(input, "mode", "string")).toEqual({
      present: true,
      value: "recent",
    });
    expect(normalizeOwnQueryParameter(input, "limit", "safe-integer")).toEqual({
      present: true,
      value: "3",
    });
  });

  it("does not traverse a prototype or invoke its getter", () => {
    const getter = vi.fn(() => "exact");
    const prototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(prototype, "mode", { get: getter });
    const input = Object.create(prototype) as Record<string, unknown>;

    expect(normalizeOwnQueryParameter(input, "mode", "string")).toEqual({
      present: false,
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects an own accessor without invoking it", () => {
    const getter = vi.fn(() => "exact");
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(input, "mode", { get: getter });

    expect(() => normalizeOwnQueryParameter(input, "mode", "string")).toThrow(
      "Invalid own query property: mode",
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("fails closed when a proxy descriptor trap throws", () => {
    const input = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor trap");
      },
    });

    expect(() => normalizeOwnQueryParameter(
      input,
      "limit",
      "safe-integer",
    )).toThrow("Invalid own query property: limit");
  });

  it("fails closed for a revoked proxy", () => {
    const revocable = Proxy.revocable({ mode: "recent" }, {});
    revocable.revoke();

    expect(() => normalizeOwnQueryParameter(
      revocable.proxy,
      "mode",
      "string",
    )).toThrow("Invalid own query property: mode");
  });

  it("does not touch caller iteration hooks", () => {
    const iterator = vi.fn(() => {
      throw new Error("iterator must not run");
    });
    const input = ["ignored"] as unknown as Record<PropertyKey, unknown>;
    input.mode = "recent";
    Object.defineProperty(input, Symbol.iterator, { get: iterator });

    expect(normalizeOwnQueryParameter(input, "mode", "string")).toEqual({
      present: true,
      value: "recent",
    });
    expect(iterator).not.toHaveBeenCalled();
  });

  it("does not coerce object values", () => {
    const toString = vi.fn(() => "3");
    const input = { limit: { toString } };

    expect(() => normalizeOwnQueryParameter(
      input,
      "limit",
      "safe-integer",
    )).toThrow("Invalid own query property: limit");
    expect(toString).not.toHaveBeenCalled();
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects unsafe integer value %s", (limit) => {
    expect(() => normalizeOwnQueryParameter(
      { limit },
      "limit",
      "safe-integer",
    )).toThrow("Invalid own query property: limit");
  });

  it.each([null, undefined, "recent", 3])(
    "rejects a non-object query input %s",
    (input) => {
      expect(() => normalizeOwnQueryParameter(input, "mode", "string")).toThrow(
        "Invalid own query property: mode",
      );
    },
  );
});
