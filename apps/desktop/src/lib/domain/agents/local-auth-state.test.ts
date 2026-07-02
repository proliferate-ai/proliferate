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

describe("planLocalAuthStatePush across direct runtimes", () => {
  // A target-scoped document: the ssh runtime overrides claude to an api_key
  // route while inheriting the default codex selection (spec §3.1 render).
  function targetState(overrides: Partial<AgentAuthState> = {}): AgentAuthState {
    return state({
      selections: [
        {
          harness: "claude",
          route: "api_key",
          slot: "primary",
          provider: "anthropic",
          key: "sk-target-override",
        },
        {
          harness: "codex",
          route: "api_key",
          slot: "primary",
          provider: "openai",
          key: "sk-raw",
        },
      ],
      ...overrides,
    });
  }

  it("plans the default and target documents independently", () => {
    const defaultPlan = planLocalAuthStatePush({
      state: state(),
      lastPushedFingerprint: null,
    });
    const targetPlan = planLocalAuthStatePush({
      state: targetState(),
      lastPushedFingerprint: null,
    });
    expect(defaultPlan.shouldPush).toBe(true);
    expect(targetPlan.shouldPush).toBe(true);
    expect(targetPlan.fingerprint).not.toBe(defaultPlan.fingerprint);
  });

  it("pushes a target override even when the default doc was already pushed", () => {
    const plan = planLocalAuthStatePush({
      state: targetState(),
      lastPushedFingerprint: localAuthStateFingerprint(state()),
    });
    expect(plan.shouldPush).toBe(true);
  });

  it("plans a zero-override runtime exactly like the default document", () => {
    const inherited = planLocalAuthStatePush({
      state: state(),
      lastPushedFingerprint: localAuthStateFingerprint(state()),
    });
    expect(inherited.shouldPush).toBe(false);
    expect(inherited.fingerprint).toBe(localAuthStateFingerprint(state()));
  });

  it("never pushes a target-scoped revision-0 marker", () => {
    const plan = planLocalAuthStatePush({
      state: targetState({ revision: 0, selections: [] }),
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
