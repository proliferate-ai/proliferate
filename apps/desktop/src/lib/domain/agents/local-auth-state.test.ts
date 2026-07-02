import { describe, expect, it } from "vitest";
import type { AgentAuthState } from "@proliferate/cloud-sdk";
import {
  localAuthStateFingerprint,
  planLocalAuthStatePush,
} from "./local-auth-state";

function state(overrides: Partial<AgentAuthState> = {}): AgentAuthState {
  return {
    revision: 3,
    user_id: "user-1",
    selections: [
      { harness: "claude", route: "native", slot: "primary" },
      {
        harness: "codex",
        route: "api_key",
        slot: "primary",
        provider: "openai",
        key: "sk-raw",
      },
    ],
    ...overrides,
  };
}

describe("planLocalAuthStatePush", () => {
  it("pushes a scoped document that was never pushed", () => {
    const plan = planLocalAuthStatePush({
      state: state(),
      lastPushedFingerprint: null,
    });
    expect(plan.shouldPush).toBe(true);
    expect(plan.fingerprint).toBe(localAuthStateFingerprint(state()));
  });

  it("skips an unchanged document", () => {
    const plan = planLocalAuthStatePush({
      state: state(),
      lastPushedFingerprint: localAuthStateFingerprint(state()),
    });
    expect(plan.shouldPush).toBe(false);
  });

  it("re-pushes when content changes without a revision bump", () => {
    const plan = planLocalAuthStatePush({
      state: state(),
      lastPushedFingerprint: localAuthStateFingerprint(
        state({
          selections: [{ harness: "claude", route: "native", slot: "primary" }],
        }),
      ),
    });
    expect(plan.shouldPush).toBe(true);
  });

  it("never pushes the revision-0 legacy marker", () => {
    const plan = planLocalAuthStatePush({
      state: state({ revision: 0, selections: [] }),
      lastPushedFingerprint: null,
    });
    expect(plan.shouldPush).toBe(false);
  });
});

describe("localAuthStateFingerprint", () => {
  it("is insensitive to object key order", () => {
    const a = localAuthStateFingerprint(state());
    const shuffled = JSON.parse(
      JSON.stringify({
        selections: state().selections,
        user_id: state().user_id,
        revision: state().revision,
      }),
    ) as AgentAuthState;
    expect(localAuthStateFingerprint(shuffled)).toBe(a);
  });

  it("changes when key material rotates", () => {
    const rotated = state();
    rotated.selections = rotated.selections.map((selection) =>
      selection.harness === "codex" ? { ...selection, key: "sk-new" } : selection,
    );
    expect(localAuthStateFingerprint(rotated)).not.toBe(
      localAuthStateFingerprint(state()),
    );
  });
});
