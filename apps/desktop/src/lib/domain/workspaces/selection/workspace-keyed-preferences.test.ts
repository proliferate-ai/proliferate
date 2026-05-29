import { describe, expect, it } from "vitest";
import { resolveWithWorkspaceFallback } from "./workspace-keyed-preferences";

describe("resolveWithWorkspaceFallback", () => {
  it("uses own-property semantics so falsy values block fallback", () => {
    expect(resolveWithWorkspaceFallback(
      { logical: false, materialized: true },
      "logical",
      "materialized",
    )).toMatchObject({
      value: false,
      source: "primary",
      shouldWriteBack: false,
    });

    expect(resolveWithWorkspaceFallback(
      { logical: null, materialized: "old" },
      "logical",
      "materialized",
    )).toMatchObject({
      value: null,
      source: "primary",
      shouldWriteBack: false,
    });

    expect(resolveWithWorkspaceFallback(
      { logical: [], materialized: ["old"] },
      "logical",
      "materialized",
    )).toMatchObject({
      value: [],
      source: "primary",
      shouldWriteBack: false,
    });
  });

  it("reports fallback hits without mutating the map", () => {
    const map = { materialized: ["chat:s1"] };
    const result = resolveWithWorkspaceFallback(map, "logical", "materialized");

    expect(result).toMatchObject({
      value: ["chat:s1"],
      source: "fallback",
      sourceKey: "materialized",
      shouldWriteBack: true,
    });
    expect(map).toEqual({ materialized: ["chat:s1"] });
  });
});
