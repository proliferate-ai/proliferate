import { describe, expect, it } from "vitest";
import {
  directRuntimeAttachStateLabel,
  directRuntimeAttachStateTone,
  directRuntimeEditsDeferred,
  loopbackDisplayNameFromHostname,
} from "./direct-runtime-presentation";
import type { DirectRuntimeConnectionState } from "./direct-runtime";

const STATES: DirectRuntimeConnectionState[] = [
  "attached",
  "connecting",
  "unreachable",
  "detached",
];

describe("direct-runtime attach presentation", () => {
  it("maps every attach state to a label and a Badge tone", () => {
    expect(STATES.map(directRuntimeAttachStateLabel)).toEqual([
      "Attached",
      "Connecting",
      "Unreachable",
      "Detached",
    ]);
    expect(STATES.map(directRuntimeAttachStateTone)).toEqual([
      "success",
      "info",
      "destructive",
      "neutral",
    ]);
  });

  it("defers edits for every non-attached state (configure-while-offline)", () => {
    expect(directRuntimeEditsDeferred("attached")).toBe(false);
    expect(directRuntimeEditsDeferred("connecting")).toBe(true);
    expect(directRuntimeEditsDeferred("unreachable")).toBe(true);
    expect(directRuntimeEditsDeferred("detached")).toBe(true);
  });

  it("derives This Mac's display name from the hostname", () => {
    expect(loopbackDisplayNameFromHostname("Pablos-MacBook-Pro.local")).toBe(
      "Pablos-MacBook-Pro",
    );
    expect(loopbackDisplayNameFromHostname("devbox")).toBe("devbox");
    expect(loopbackDisplayNameFromHostname("  ")).toBe("This Mac");
    expect(loopbackDisplayNameFromHostname(null)).toBe("This Mac");
  });
});
