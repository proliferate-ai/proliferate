import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  POPOVER_FRAME_CLASS,
  POPOVER_FRAME_IMPORTANT_CLASS,
} from "../src/primitives/popover-surface";

/**
 * Why this file exists.
 *
 * The important variant of the popover frame used to be produced at runtime, by
 * mapping `!` onto each utility of the plain frame. It read as obviously
 * correct and it was silently inert: Tailwind generates utilities by scanning
 * source *text*, so a class name that only ever exists as a runtime string is
 * in no stylesheet, and every property it claimed to own did nothing. Sonner's
 * own `background: var(--normal-bg)` won instead, which is why light-mode
 * toasts rendered as flat black cards.
 *
 * So the important variant has to stay a literal — and a literal can drift from
 * the plain frame it mirrors. These two tests are the trade: one pins the
 * pairing, the other pins the reason the pairing can't be computed.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL("../src/primitives/popover-surface.ts", import.meta.url)),
  "utf8",
);

describe("popover frame", () => {
  it("keeps the important variant in lockstep with the plain frame", () => {
    const expected = POPOVER_FRAME_CLASS.split(" ").map((utility) => `!${utility}`);
    expect(POPOVER_FRAME_IMPORTANT_CLASS.split(" ")).toEqual(expected);
  });

  it("spells every important utility out literally so Tailwind can see it", () => {
    // Each utility must appear verbatim in the file. A future refactor that
    // reintroduces `.map((u) => "!" + u)` passes the test above and fails here.
    for (const utility of POPOVER_FRAME_IMPORTANT_CLASS.split(" ")) {
      expect(SOURCE).toContain(utility);
    }
  });
});
