import { describe, expect, it } from "vitest";
import { ownsCoworkNewThreadShortcut } from "#product/lib/domain/cowork/new-thread-shortcut";

describe("ownsCoworkNewThreadShortcut", () => {
  it("owns Cmd-N only on the active Cowork shell", () => {
    expect(ownsCoworkNewThreadShortcut("/", "cowork")).toBe(true);
    expect(ownsCoworkNewThreadShortcut("/", "standard")).toBe(false);
    expect(ownsCoworkNewThreadShortcut("/settings", "cowork")).toBe(false);
  });
});
