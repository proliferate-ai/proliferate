import { describe, expect, it } from "vitest";
import { hashAppQueryKey } from "./query-client";

describe("hashAppQueryKey", () => {
  it("hashes plain query keys with sorted object fields", () => {
    expect(hashAppQueryKey(["cloud", { repo: "b", owner: "a" }])).toBe(
      '["cloud",{"owner":"a","repo":"b"}]',
    );
  });

  it("does not recurse forever on cyclic query keys", () => {
    const value: { id: string; self?: unknown } = { id: "cycle" };
    value.self = value;

    expect(hashAppQueryKey(["workspace", value])).toBe(
      '["workspace",{"id":"cycle","self":"[Circular]"}]',
    );
  });

  it("summarizes non-plain objects instead of traversing browser objects", () => {
    const event = new Event("click");

    expect(hashAppQueryKey(["event", event])).toBe('["event","[Event]"]');
  });
});
