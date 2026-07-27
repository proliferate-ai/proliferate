import { describe, expect, it } from "vitest";
import { findComposerMenuTrigger } from "#product/lib/domain/chat/composer/composer-menu-trigger";

describe("findComposerMenuTrigger", () => {
  it("resolves a prompt-leading slash to the command menu", () => {
    expect(findComposerMenuTrigger("/rev", 4)).toEqual({
      kind: "slash",
      start: 0,
      end: 4,
      query: "rev",
    });
  });

  it("resolves an @ token to the mention menu", () => {
    expect(findComposerMenuTrigger("look at @rea", 12)).toEqual({
      kind: "mention",
      start: 8,
      end: 12,
      query: "rea",
    });
  });

  it("never opens both menus: an inline slash is prompt text, not a command", () => {
    expect(findComposerMenuTrigger("a/b", 3)).toBeNull();
  });

  it("prefers the slash menu when both patterns could match the same caret", () => {
    // "/@x" is a slash token at prompt start; the "@" is inside it, so the
    // mention rule does not apply and only one menu can open.
    expect(findComposerMenuTrigger("/@x", 3)?.kind).toBe("slash");
  });

  it("returns nothing for ordinary prose", () => {
    expect(findComposerMenuTrigger("ship the thing", 14)).toBeNull();
  });
});
