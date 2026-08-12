import { describe, expect, it } from "vitest";
import type { MeasuredSupportWindow } from "#product/lib/domain/support/support-session-contract";
import {
  decodeSupportWindow,
  type ExpectedSupportWindow,
} from "#product/lib/domain/support/support-session-window";

const expected: ExpectedSupportWindow = {
  presentationOrder: "seq_asc",
  itemLimit: 2,
  responseByteLimit: 1_024,
};

function window(items: unknown[], overrides: Record<string, unknown> = {}): MeasuredSupportWindow {
  return {
    responseBytes: 24,
    value: {
      items,
      window: {
        schemaVersion: 1,
        selection: "newest_matching",
        presentationOrder: "seq_asc",
        itemLimit: 2,
        responseByteLimit: 1_024,
        returnedItems: items.length,
        omittedOversizedItems: 0,
        completeness: "complete",
        ...overrides,
      },
    },
  };
}

describe("support session window decoder", () => {
  it("preserves exact valid server metadata and item positions", () => {
    const measured = window([{ seq: 1 }, { seq: 2 }], {
      completeness: "limit_uncertain",
      omittedOversizedItems: 1,
    });
    expect(decodeSupportWindow(measured, expected)).toEqual({
      state: "decoded",
      responseBytes: 24,
      items: [{ seq: 1 }, { seq: 2 }],
      window: (measured.value as { window: unknown }).window,
    });
  });

  it("does not invoke measured or envelope accessors", () => {
    let invoked = 0;
    const measured = {};
    Object.defineProperties(measured, {
      responseBytes: {
        enumerable: true,
        get() {
          invoked += 1;
          return 10;
        },
      },
      value: { enumerable: true, value: {} },
    });
    expect(decodeSupportWindow(measured as MeasuredSupportWindow, expected))
      .toEqual({ state: "invalid", responseBytes: null });

    const envelope = { window: (window([], {}).value as { window: unknown }).window };
    Object.defineProperty(envelope, "items", {
      enumerable: true,
      get() {
        invoked += 1;
        return [];
      },
    });
    expect(decodeSupportWindow({ value: envelope, responseBytes: 10 }, expected))
      .toEqual({ state: "invalid", responseBytes: 10 });
    expect(invoked).toBe(0);
  });

  it("closes revoked proxies, sparse/extended arrays, prototypes, and symbols", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const sparse = new Array(1);
    const extended = [null] as unknown[] & { extra?: boolean };
    extended.extra = true;
    const symbol = [null] as Array<unknown> & Record<symbol, unknown>;
    symbol[Symbol("extra")] = true;
    const customMeta = Object.create({ inherited: true });
    Object.assign(customMeta, (window([], {}).value as { window: object }).window);
    const nullMeta = Object.assign(
      Object.create(null),
      (window([], {}).value as { window: object }).window,
    );
    for (const measured of [
      { value: revoked.proxy, responseBytes: 10 },
      window(sparse),
      window(extended),
      window(symbol),
      { value: { items: [], window: customMeta }, responseBytes: 10 },
      { value: { items: [], window: nullMeta }, responseBytes: 10 },
    ]) {
      expect(decodeSupportWindow(measured, expected).state).toBe("invalid");
    }
  });

  it("rejects malformed counts, signed zero, extra keys, and byte overflow", () => {
    expect(decodeSupportWindow(window([], { returnedItems: 1 }), expected))
      .toMatchObject({ state: "decoded", items: [], window: { returnedItems: 1 } });
    expect(decodeSupportWindow(window([], { returnedItems: -0 }), expected).state)
      .toBe("invalid");
    expect(decodeSupportWindow(window([], { extra: true }), expected).state)
      .toBe("invalid");
    expect(decodeSupportWindow({ ...window([]), extra: true }, expected))
      .toEqual({ state: "invalid", responseBytes: 24 });
    expect(decodeSupportWindow({ ...window([]), responseBytes: 1_025 }, expected))
      .toEqual({ state: "invalid", responseBytes: null });
  });
});
