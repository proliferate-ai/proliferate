import { describe, expect, it } from "vitest";
import {
  isPersistableLogicalWorkspaceSelection,
  normalizePersistedLogicalWorkspaceSelection,
} from "./persisted-logical-workspace-selection";

describe("persisted logical workspace selection", () => {
  it("keeps stable logical workspace ids", () => {
    expect(normalizePersistedLogicalWorkspaceSelection("workspace-1"))
      .toBe("workspace-1");
    expect(normalizePersistedLogicalWorkspaceSelection("local-slot:workspace-1"))
      .toBe("local-slot:workspace-1");
  });

  it("normalizes nullish values to null", () => {
    expect(normalizePersistedLogicalWorkspaceSelection(null)).toBeNull();
    expect(normalizePersistedLogicalWorkspaceSelection(undefined)).toBeNull();
  });

  it("normalizes transient pending workspace ids to null on read", () => {
    expect(normalizePersistedLogicalWorkspaceSelection("pending-workspace:abc"))
      .toBeNull();
  });

  it("persists stable and null selections but skips transient pending selections", () => {
    expect(isPersistableLogicalWorkspaceSelection("workspace-1")).toBe(true);
    expect(isPersistableLogicalWorkspaceSelection("local-slot:workspace-1")).toBe(true);
    expect(isPersistableLogicalWorkspaceSelection(null)).toBe(true);
    expect(isPersistableLogicalWorkspaceSelection(undefined)).toBe(false);
    expect(isPersistableLogicalWorkspaceSelection("pending-workspace:abc")).toBe(false);
  });
});
