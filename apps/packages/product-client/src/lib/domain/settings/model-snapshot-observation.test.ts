import { describe, expect, it } from "vitest";
import type { ModelSnapshotStatus } from "@anyharness/sdk";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import {
  formatSnapshotAge,
  resolveComposedObservation,
} from "./model-snapshot-observation";

function status(overrides: Partial<ModelSnapshotStatus> = {}): ModelSnapshotStatus {
  return {
    agent: "codex",
    probeEngine: "owner",
    schemaVersion: 2,
    state: "idle",
    modelCount: 0,
    modeCount: 0,
    ...overrides,
  };
}

describe("resolveComposedObservation", () => {
  it("is null only while no status has loaded", () => {
    expect(resolveComposedObservation(undefined)).toBeNull();
    expect(resolveComposedObservation(status())).not.toBeNull();
  });

  it("projects one composed observation: models, modes, age, and engine state", () => {
    const observation = resolveComposedObservation(status({
      state: "idle",
      probedAt: "2026-07-27T09:12:03Z",
      snapshotAgeSeconds: 90,
      modelCount: 2,
      modeCount: 1,
      models: [
        {
          id: "proliferate/claude-fable-5",
          provider: "proliferate",
          name: "Claude Fable 5",
        },
        { id: "anthropic/claude-fable-5", provider: "anthropic" },
      ] as unknown as ModelSnapshotStatus["models"],
      modes: [{ id: "build", name: "Build" }] as unknown as ModelSnapshotStatus["modes"],
    }));

    expect(observation).not.toBeNull();
    expect(observation?.engineState).toBe("idle");
    expect(observation?.probedAt).toBe("2026-07-27T09:12:03Z");
    expect(observation?.ageSeconds).toBe(90);
    expect(observation?.modes).toEqual(["Build"]);
    // The harness's `name` becomes the table's displayName; a nameless entry
    // renders id-shaped; `provider` is carried verbatim.
    expect(observation?.models).toMatchObject([
      {
        id: "proliferate/claude-fable-5",
        displayName: "Claude Fable 5",
        provider: "proliferate",
        enabled: true,
      },
      {
        id: "anthropic/claude-fable-5",
        displayName: "anthropic/claude-fable-5",
        provider: "anthropic",
        enabled: true,
      },
    ]);
  });

  it("keeps the last-good observation and flags a failed refresh via lastAttempt", () => {
    const observation = resolveComposedObservation(status({
      probedAt: "2026-07-27T08:00:00Z",
      snapshotAgeSeconds: 4000,
      models: [{ id: "gpt-5.5" }] as unknown as ModelSnapshotStatus["models"],
      lastAttempt: {
        at: "2026-07-27T09:00:00Z",
        outcome: "failed",
        detail: "harness crashed",
      } as unknown as ModelSnapshotStatus["lastAttempt"],
      lastError: "harness crashed",
    }));

    expect(observation?.lastAttemptFailed).toBe(true);
    expect(observation?.lastError).toBe("harness crashed");
    // A failed refresh never destroys truth: the last-good list keeps serving.
    expect(observation?.models).toHaveLength(1);
    expect(observation?.probedAt).toBe("2026-07-27T08:00:00Z");
  });

  it("does not flag an ok attempt", () => {
    const observation = resolveComposedObservation(status({
      lastAttempt: {
        at: "2026-07-27T09:12:03Z",
        outcome: "ok",
        detail: null,
      } as unknown as ModelSnapshotStatus["lastAttempt"],
    }));

    expect(observation?.lastAttemptFailed).toBe(false);
    expect(observation?.lastError).toBeNull();
  });

  it("formats the diagnostics-only provenance line from attestation and install identity", () => {
    const observation = resolveComposedObservation(status({
      attestation: {
        name: "opencode",
        version: "0.3.112",
      } as unknown as ModelSnapshotStatus["attestation"],
      installIdentity: {
        role: "agent_process",
        version: "1.18.3",
        source: "pinned_archive",
      } as unknown as ModelSnapshotStatus["installIdentity"],
    }));

    expect(observation?.provenance).toBe("opencode 0.3.112 · install 1.18.3 (pinned_archive)");
  });

  it("omits provenance when neither field is recorded", () => {
    const observation = resolveComposedObservation(status({
      attestation: null,
      installIdentity: null,
    }));

    expect(observation?.provenance).toBeNull();
  });

  it("reports no observation fields before the first successful probe", () => {
    const observation = resolveComposedObservation(status({ state: "running" }));

    expect(observation?.probedAt).toBeNull();
    expect(observation?.ageSeconds).toBeNull();
    expect(observation?.models).toEqual([]);
    expect(observation?.modes).toEqual([]);
    expect(observation?.engineState).toBe("running");
  });
});

describe("formatSnapshotAge", () => {
  it("formats sub-minute ages as just now", () => {
    expect(formatSnapshotAge(0)).toBe("just now");
    expect(formatSnapshotAge(59)).toBe("just now");
  });

  it("formats minutes, hours, and days", () => {
    expect(formatSnapshotAge(90)).toBe("1m");
    expect(formatSnapshotAge(3600)).toBe("1h");
    expect(formatSnapshotAge(90000)).toBe("1d");
  });

  it("clamps negative ages to zero", () => {
    expect(formatSnapshotAge(-5)).toBe("just now");
  });
});

describe("HARNESS_PANE_COPY.allModelsFreshRefreshedAgo (composed string)", () => {
  it("reads \"refreshed just now\" for sub-minute ages, never \"refreshed just now ago\"", () => {
    const composed = HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(formatSnapshotAge(0));
    expect(composed).toBe("refreshed just now");
    expect(composed).not.toContain("just now ago");
  });

  it("reads \"refreshed Nm/h/d ago\" for a minute-or-larger age", () => {
    expect(HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(formatSnapshotAge(90))).toBe(
      "refreshed 1m ago",
    );
    expect(HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(formatSnapshotAge(3600))).toBe(
      "refreshed 1h ago",
    );
    expect(HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(formatSnapshotAge(90000))).toBe(
      "refreshed 1d ago",
    );
  });
});
