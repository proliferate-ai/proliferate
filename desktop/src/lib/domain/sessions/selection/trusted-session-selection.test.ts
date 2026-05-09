import { describe, expect, it } from "vitest";
import { resolveTrustedSessionSelectionRelationship } from "@/lib/domain/sessions/selection/trusted-session-selection";

type TestRelationship =
  | { kind: "pending" }
  | { kind: "root" }
  | { kind: "child"; parentSessionId: string };

type TestChildRelationship = Extract<TestRelationship, { kind: "child" }>;

const ROOT_RELATIONSHIP: TestRelationship = { kind: "root" };

describe("resolveTrustedSessionSelectionRelationship", () => {
  it("keeps an already trusted relationship without a store commit", () => {
    const currentRelationship: TestRelationship = {
      kind: "child",
      parentSessionId: "parent-session",
    };

    expect(resolveTrustedSessionSelectionRelationship<TestRelationship, TestChildRelationship>({
      currentRelationship,
      relationshipHint: null,
      rootRelationship: ROOT_RELATIONSHIP,
    })).toEqual({
      commitAction: "none",
      relationship: currentRelationship,
    });
  });

  it("applies a child hint when the current relationship is pending", () => {
    const relationshipHint: TestChildRelationship = {
      kind: "child",
      parentSessionId: "parent-session",
    };

    expect(resolveTrustedSessionSelectionRelationship<TestRelationship, TestChildRelationship>({
      currentRelationship: { kind: "pending" },
      relationshipHint,
      rootRelationship: ROOT_RELATIONSHIP,
    })).toEqual({
      commitAction: "apply_hint",
      relationship: relationshipHint,
    });
  });

  it("promotes a pending session to root when no child hint exists", () => {
    expect(resolveTrustedSessionSelectionRelationship<TestRelationship, TestChildRelationship>({
      currentRelationship: { kind: "pending" },
      relationshipHint: null,
      rootRelationship: ROOT_RELATIONSHIP,
    })).toEqual({
      commitAction: "promote_root",
      relationship: ROOT_RELATIONSHIP,
    });
  });
});
