import { describe, expect, it } from "vitest";

import {
  canonicalQueueJson,
  compareUnicodeCodePoints,
  QueueCanonicalError,
  queueUtf8Bytes,
  sha256QueueText,
} from "./support-report-queue-canonical";

describe("support queue canonical JSON", () => {
  it("orders keys by Unicode code point without normalizing strings", () => {
    const astral = "\u{10000}";
    const privateUse = "\uE000";
    expect(compareUnicodeCodePoints(privateUse, astral)).toBeLessThan(0);
    expect(canonicalQueueJson({ [astral]: "e\u0301", [privateUse]: "é", a: 1 })).toBe(
      `{"a":1,"${privateUse}":"é","${astral}":"é"}`,
    );
  });

  it("keeps arrays in declared order and permits repeated non-cyclic references", () => {
    const shared = { b: 2, a: 1 };
    expect(canonicalQueueJson([shared, shared, "last"])).toBe(
      `[{"a":1,"b":2},{"a":1,"b":2},"last"]`,
    );
  });

  it.each([
    ["fraction", 1.5],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["negative zero", -0],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["bigint", 1n],
    ["undefined", undefined],
    ["function", () => undefined],
    ["symbol", Symbol("value")],
    ["date", new Date(0)],
    ["null prototype", Object.create(null)],
  ])("rejects %s", (_name, value) => {
    expect(() => canonicalQueueJson(value)).toThrow(QueueCanonicalError);
  });

  it("rejects holes, extra array properties, accessors, symbols, and cycles", () => {
    const sparse = new Array(2);
    sparse[1] = "present";
    expect(() => canonicalQueueJson(sparse)).toThrow(QueueCanonicalError);

    const extra = ["value"] as unknown[] & { extra?: string };
    extra.extra = "not JSON array data";
    expect(() => canonicalQueueJson(extra)).toThrow(QueueCanonicalError);

    const getter = Object.defineProperty({}, "secret", { enumerable: true, get: () => "no" });
    expect(() => canonicalQueueJson(getter)).toThrow(QueueCanonicalError);
    expect(() => canonicalQueueJson({ [Symbol("key")]: "value" })).toThrow(QueueCanonicalError);

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalQueueJson(cycle)).toThrow(QueueCanonicalError);
  });

  it("does not invoke getters and fails closed for a revoked proxy", () => {
    let invoked = false;
    const getter = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        invoked = true;
        return "secret";
      },
    });
    expect(() => canonicalQueueJson(getter)).toThrow(QueueCanonicalError);
    expect(invoked).toBe(false);

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => canonicalQueueJson(proxy)).toThrow(QueueCanonicalError);
  });

  it("does not read an array length through a proxy get trap", () => {
    let read = false;
    const proxy = new Proxy(["value"], {
      get(target, property, receiver) {
        if (property === "length") read = true;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(canonicalQueueJson(proxy)).toBe('["value"]');
    expect(read).toBe(false);
  });

  it("takes one key snapshot from a stateful Proxy", () => {
    let ownKeyCalls = 0;
    const proxy = new Proxy({ first: 1, second: 2 }, {
      ownKeys() {
        ownKeyCalls += 1;
        return ownKeyCalls === 1 ? ["first", "second"] : ["first"];
      },
    });
    expect(canonicalQueueJson(proxy)).toBe('{"first":1,"second":2}');
    expect(ownKeyCalls).toBe(1);
  });

  it("counts UTF-8 bytes and hashes the exact canonical text", async () => {
    expect(queueUtf8Bytes("é")).toBe(2);
    await expect(sha256QueueText("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
