import { describe, expect, it } from "vitest";
import {
  compareUnicodeCodePoints,
  createSupportProjectionBudget,
  projectSupportSessionSummaryValue,
  projectSupportSessionValue,
  stringifySupportSessionEvidence,
} from "#product/lib/domain/support/support-session-projector";

function nested(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = { value };
  return value;
}

function valueBudgetFixture(tailLength: number): unknown[] {
  return [
    ...Array.from({ length: 39 }, () => new Array(255).fill(null)),
    new Array(tailLength).fill(null),
  ];
}

describe("support session projector", () => {
  it("copies stable own data without invoking accessors, iteration, or toJSON", () => {
    let invoked = 0;
    const value = {
      "😀": "astral",
      z: 2,
      a: { content: "kept customer content" },
    };
    Object.defineProperty(value, "__proto__", {
      enumerable: true,
      configurable: true,
      value: { content: "safe own proto-shaped content" },
    });
    Object.defineProperty(value, "hidden", {
      value: "ignored",
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(value, "getter", {
      enumerable: true,
      configurable: true,
      get() {
        invoked += 1;
        return "secret";
      },
    });
    expect(projectSupportSessionValue(value, createSupportProjectionBudget()))
      .toEqual({ state: "invalid" });
    expect(invoked).toBe(0);

    delete (value as { getter?: unknown }).getter;
    delete (value as { hidden?: unknown }).hidden;
    const projected = projectSupportSessionValue(value, createSupportProjectionBudget());
    expect(projected.state).toBe("projected");
    if (projected.state === "projected") {
      expect(stringifySupportSessionEvidence(projected.value))
        .toBe(
          '{"__proto__":{"content":"safe own proto-shaped content"},'
          + '"a":{"content":"kept customer content"},"z":2,"😀":"astral"}',
        );
    }
  });

  it("closes revoked/trapped proxies, cycles, custom prototypes, sparse arrays, and symbols", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const trapped = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("trap"); } });
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const custom = Object.create({ inherited: "value" });
    custom.own = true;
    const nullPrototype = Object.assign(Object.create(null), { own: true });
    const sparse = new Array(2);
    sparse[1] = "value";
    const hidden = {};
    Object.defineProperty(hidden, "value", { value: true, enumerable: false });
    const symbolValue = { value: true } as Record<string | symbol, unknown>;
    symbolValue[Symbol("hidden")] = true;
    for (const value of [
      proxy,
      trapped,
      cycle,
      custom,
      nullPrototype,
      sparse,
      hidden,
      symbolValue,
    ]) {
      expect(projectSupportSessionValue(value, createSupportProjectionBudget()))
        .toEqual({ state: "invalid" });
    }
  });

  it("enforces inclusive depth, container, value, string, and identifier caps", () => {
    const exactlyTenThousand = valueBudgetFixture(14);
    const overTenThousand = valueBudgetFixture(15);
    expect(projectSupportSessionValue(nested(16), createSupportProjectionBudget()).state)
      .toBe("projected");
    expect(projectSupportSessionValue(nested(17), createSupportProjectionBudget()))
      .toEqual({ state: "invalid" });
    expect(projectSupportSessionValue(new Array(257).fill(null), createSupportProjectionBudget()))
      .toEqual({ state: "invalid" });
    expect(projectSupportSessionValue(Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`key${index}`, null]),
    ), createSupportProjectionBudget())).toEqual({ state: "invalid" });
    expect(projectSupportSessionValue({ id: "x".repeat(129) }, createSupportProjectionBudget()))
      .toEqual({ state: "invalid" });
    expect(projectSupportSessionValue({ id: "😀".repeat(33) }, createSupportProjectionBudget()))
      .toEqual({ state: "invalid" });
    expect(projectSupportSessionValue({ generic: "x".repeat(4097) }, createSupportProjectionBudget()))
      .toEqual({ state: "invalid" });
    expect(projectSupportSessionValue({ content: "x".repeat(16385) }, createSupportProjectionBudget()))
      .toEqual({ state: "invalid" });
    expect(projectSupportSessionValue({ messages: ["x".repeat(16_384)] },
      createSupportProjectionBudget()).state).toBe("projected");
    expect(projectSupportSessionValue({ ids: ["x".repeat(129)] }, createSupportProjectionBudget()))
      .toEqual({ state: "invalid" });
    expect(projectSupportSessionValue({ ["\ud800"]: "invalid" }, createSupportProjectionBudget()))
      .toEqual({ state: "invalid" });
    expect(projectSupportSessionValue(exactlyTenThousand, createSupportProjectionBudget()).state)
      .toBe("projected");
    expect(projectSupportSessionValue(overTenThousand, createSupportProjectionBudget()))
      .toEqual({ state: "invalid" });
    expect(projectSupportSessionValue({ invalid: "x".repeat(129), paid: "y".repeat(129) },
      createSupportProjectionBudget()).state).toBe("projected");
  });

  it("never invokes inherited getters, custom iteration, or toJSON", () => {
    let invoked = 0;
    const inherited = Object.create({
      get value() {
        invoked += 1;
        return "forbidden";
      },
    });
    inherited.own = true;
    const iterable = ["safe"];
    Object.defineProperty(iterable, Symbol.iterator, {
      value: () => {
        invoked += 1;
        return [][Symbol.iterator]();
      },
    });
    const serializable = {
      toJSON() {
        invoked += 1;
        return { leaked: true };
      },
    };
    for (const value of [inherited, iterable, serializable]) {
      expect(projectSupportSessionValue(value, createSupportProjectionBudget()).state)
        .toBe("invalid");
    }
    expect(invoked).toBe(0);
  });

  it("omits top-level live config without reading it", () => {
    let invoked = 0;
    const summary = { id: "session-1" };
    Object.defineProperty(summary, "liveConfig", {
      enumerable: true,
      get() {
        invoked += 1;
        return { modelId: "not-collected" };
      },
    });
    expect(projectSupportSessionSummaryValue(summary, createSupportProjectionBudget()))
      .toEqual({ state: "projected", value: { id: "session-1" } });
    expect(invoked).toBe(0);
  });

  it.each([
    [-1, "invalid"],
    [-0, "invalid"],
    [Number.MAX_SAFE_INTEGER + 1, "invalid"],
    [-1.5, "projected"],
    [0, "projected"],
  ] as const)("mirrors Rust numeric validation for %s", (number, state) => {
    expect(projectSupportSessionValue(number, createSupportProjectionBudget()).state).toBe(state);
  });

  it("uses Unicode code-point ordering", () => {
    expect(["😀", "z", "é", "a"].sort(compareUnicodeCodePoints))
      .toEqual(["a", "z", "é", "😀"]);
  });

  it("measures the canonical JSON UTF-8 boundary exactly", () => {
    const atBoundary = stringifySupportSessionEvidence("x".repeat(8_388_606));
    const overBoundary = stringifySupportSessionEvidence("x".repeat(8_388_607));
    expect(new TextEncoder().encode(atBoundary).length).toBe(8_388_608);
    expect(new TextEncoder().encode(overBoundary).length).toBe(8_388_609);
  });
});
