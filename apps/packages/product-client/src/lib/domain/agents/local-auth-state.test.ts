import { describe, expect, it } from "vitest";
import type { AgentAuthState } from "@proliferate/cloud-sdk";
import {
  localAuthStateFingerprint,
  planLocalAuthStatePush,
  shouldSyncLocalAuthState,
  stampIssuingServerOrigin,
} from "#product/lib/domain/agents/local-auth-state";

function state(overrides: Partial<AgentAuthState> = {}): AgentAuthState {
  return {
    version: 2,
    sequence: 3,
    lineage: "40000000-0000-4000-8000-000000000031",
    user_id: "user-1",
    harnesses: [
      {
        harness_kind: "claude",
        sources: [{ kind: "gateway", base_url: "https://gw", key: "sk-vk" }],
      },
      {
        harness_kind: "codex",
        sources: [{ kind: "api_key", env_var_name: "OPENAI_API_KEY", value: "sk-raw" }],
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
    expect(plan.action).toBe("apply");
    expect(plan.fingerprint).toBe(localAuthStateFingerprint(state()));
  });

  it("skips an unchanged document", () => {
    const plan = planLocalAuthStatePush({
      state: state(),
      lastPushedFingerprint: localAuthStateFingerprint(state()),
    });
    expect(plan.action).toBeNull();
  });

  it("re-pushes when content changes without a sequence bump", () => {
    const plan = planLocalAuthStatePush({
      state: state(),
      lastPushedFingerprint: localAuthStateFingerprint(
        state({
          harnesses: [
            { harness_kind: "claude", sources: [{ kind: "gateway", key: "sk-vk" }] },
          ],
        }),
      ),
    });
    expect(plan.action).toBe("apply");
  });

  it("clears a previously persisted route for the sequence-0 native marker", () => {
    const plan = planLocalAuthStatePush({
      state: state({ sequence: 0, harnesses: [] }),
      lastPushedFingerprint: null,
    });
    expect(plan.action).toBe("clear");
  });

  it("clears native state even when disabled rows retain a positive sequence", () => {
    const plan = planLocalAuthStatePush({
      state: state({ sequence: 8, harnesses: [] }),
      lastPushedFingerprint: null,
    });
    expect(plan.action).toBe("clear");
  });
});

describe("localAuthStateFingerprint", () => {
  it("is insensitive to object key order", () => {
    const a = localAuthStateFingerprint(state());
    const shuffled = JSON.parse(
      JSON.stringify({
        harnesses: state().harnesses,
        user_id: state().user_id,
        lineage: state().lineage,
        sequence: state().sequence,
        version: state().version,
      }),
    ) as AgentAuthState;
    expect(localAuthStateFingerprint(shuffled)).toBe(a);
  });

  it("changes when key material rotates", () => {
    const rotated = state();
    rotated.harnesses = rotated.harnesses.map((harness) =>
      harness.harness_kind === "codex"
        ? {
          ...harness,
          sources: harness.sources.map((source) => ({ ...source, value: "sk-new" })),
        }
        : harness,
    );
    expect(localAuthStateFingerprint(rotated)).not.toBe(
      localAuthStateFingerprint(state()),
    );
  });
});

describe("stampIssuingServerOrigin", () => {
  it("adds the origin without dropping any existing fields", () => {
    const stamped = stampIssuingServerOrigin(state(), "https://proliferate.corp.example");
    expect(stamped).toEqual({
      ...state(),
      issuing_server_origin: "https://proliferate.corp.example",
    });
  });

  it("strips the server's fingerprint rider before the runtime push", () => {
    // `fingerprint` exists so the desktop can echo it through the delivery
    // ack — it is NOT part of the state.json contract and must never be
    // persisted by the runtime.
    const stamped = stampIssuingServerOrigin(
      { ...state(), fingerprint: "sha-abc" },
      "https://proliferate.corp.example",
    );
    expect("fingerprint" in stamped).toBe(false);
    expect(stamped).toEqual({
      ...state(),
      issuing_server_origin: "https://proliferate.corp.example",
    });
  });

  it("strips the harness_settings rider before the runtime push", () => {
    // `harness_settings` is the settings pane's read of persisted toggles for
    // harnesses with no enabled selection; the runtime's copy is the
    // per-harness `settings` passenger inside `harnesses`, so the rider must
    // never reach the persisted state.json.
    const stamped = stampIssuingServerOrigin(
      { ...state(), harness_settings: { claude: { chrome: true } } },
      "https://proliferate.corp.example",
    );
    expect("harness_settings" in stamped).toBe(false);
    expect(stamped).toEqual({
      ...state(),
      issuing_server_origin: "https://proliferate.corp.example",
    });
  });

  it("overwrites a previous stamp on re-push after a server switch", () => {
    const first = stampIssuingServerOrigin(state(), "https://old-server.example");
    const second = stampIssuingServerOrigin(first, "https://new-server.example");
    expect(second.issuing_server_origin).toBe("https://new-server.example");
  });
});

describe("shouldSyncLocalAuthState", () => {
  it("syncs a gateway-enabled server even when cloud COMPUTE is unavailable", () => {
    // Regression: the local gateway/BYOK routes must reach the runtime on a
    // reachable, authenticated server regardless of cloud-compute (E2B). This
    // is the exact posture of the qualification local world and a local-only
    // managed-gateway user.
    expect(
      shouldSyncLocalAuthState({
        authenticated: true,
        serverReachable: true,
        runtimeHealthy: true,
      }),
    ).toBe(true);
  });

  it("does not sync until authenticated, reachable, and the runtime is healthy", () => {
    expect(
      shouldSyncLocalAuthState({ authenticated: false, serverReachable: true, runtimeHealthy: true }),
    ).toBe(false);
    expect(
      shouldSyncLocalAuthState({ authenticated: true, serverReachable: false, runtimeHealthy: true }),
    ).toBe(false);
    expect(
      shouldSyncLocalAuthState({ authenticated: true, serverReachable: true, runtimeHealthy: false }),
    ).toBe(false);
  });
});
