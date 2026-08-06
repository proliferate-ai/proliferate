import { describe, expect, it } from "vitest";
import type { RepoEnvironmentResponse } from "@proliferate/cloud-sdk";

import {
  buildCloudEnvironmentDraftBaseline,
  createCloudEnvironmentDraftState,
  patchCloudEnvironmentDraft,
  resetCloudEnvironmentDraft,
  revertCloudEnvironmentDraft,
  shouldRebaselineCloudEnvironmentDraft,
} from "./cloud-environment-draft";

function environmentFixture(
  overrides: Partial<RepoEnvironmentResponse> = {},
): RepoEnvironmentResponse {
  return {
    id: "env-1",
    repoConfigId: "repo-1",
    kind: "cloud",
    defaultBranch: "main",
    setupScript: "pnpm install",
    runCommand: "pnpm dev",
    ...overrides,
  } as RepoEnvironmentResponse;
}

describe("cloud environment draft transitions", () => {
  it("uses a seed only when no saved environment exists", () => {
    expect(buildCloudEnvironmentDraftBaseline(null, {
      setupScript: "make setup",
      runCommand: "make dev",
    })).toEqual({
      defaultBranch: null,
      setupScript: "make setup",
      runCommand: "make dev",
    });
    expect(buildCloudEnvironmentDraftBaseline(environmentFixture(), {
      setupScript: "ignored",
      runCommand: "ignored",
    })).toEqual({
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });
  });

  it("patches, reverts, and resets without changing the source key", () => {
    const baseline = buildCloudEnvironmentDraftBaseline(environmentFixture(), null);
    const initial = createCloudEnvironmentDraftState("octo/rocket", baseline);
    const patched = patchCloudEnvironmentDraft(initial, { runCommand: "pnpm start" });

    expect(patched.draft.runCommand).toBe("pnpm start");
    expect(revertCloudEnvironmentDraft(patched).draft).toEqual(baseline);

    const reset = resetCloudEnvironmentDraft(
      patched,
      environmentFixture({ runCommand: "pnpm preview" }),
    );
    expect(reset.sourceKey).toBe("octo/rocket");
    expect(reset.draft.runCommand).toBe("pnpm preview");
    expect(reset.revertDraft).toEqual(reset.draft);
  });

  it("re-baselines for a new source and for clean refetches, but not dirty drafts", () => {
    const baseline = buildCloudEnvironmentDraftBaseline(environmentFixture(), null);
    const initial = createCloudEnvironmentDraftState("octo/rocket", baseline);
    const refreshed = buildCloudEnvironmentDraftBaseline(
      environmentFixture({ runCommand: "pnpm preview" }),
      null,
    );

    expect(shouldRebaselineCloudEnvironmentDraft(initial, "octo/rocket", refreshed)).toBe(true);
    expect(shouldRebaselineCloudEnvironmentDraft(initial, "octo/booster", baseline)).toBe(true);

    const dirty = patchCloudEnvironmentDraft(initial, { runCommand: "pnpm edited" });
    expect(shouldRebaselineCloudEnvironmentDraft(dirty, "octo/rocket", refreshed)).toBe(false);
  });
});
