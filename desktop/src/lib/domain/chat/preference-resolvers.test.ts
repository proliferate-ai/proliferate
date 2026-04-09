import { describe, expect, it } from "vitest";
import { resolvePreferredOpenTarget } from "./preference-resolvers";

describe("resolvePreferredOpenTarget", () => {
  it("falls back to the first available editor when the saved target is missing", () => {
    const resolved = resolvePreferredOpenTarget(
      [
        { id: "finder", label: "Finder", kind: "finder", iconId: "finder" },
        { id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" },
        { id: "terminal", label: "Terminal", kind: "terminal", iconId: "terminal" },
      ],
      { defaultOpenInTargetId: "missing-editor" },
    );

    expect(resolved?.id).toBe("cursor");
  });

  it("falls back to the first target when no editors are available", () => {
    const resolved = resolvePreferredOpenTarget(
      [
        { id: "finder", label: "Finder", kind: "finder", iconId: "finder" },
        { id: "terminal", label: "Terminal", kind: "terminal", iconId: "terminal" },
      ],
      { defaultOpenInTargetId: "missing-editor" },
    );

    expect(resolved?.id).toBe("finder");
  });
});
