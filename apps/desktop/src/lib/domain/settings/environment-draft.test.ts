import { describe, expect, it } from "vitest";
import {
  buildLocalEnvironmentSavePatch,
  isLocalEnvironmentDraftDirty,
  normalizeLocalEnvironmentDraft,
} from "@/lib/domain/settings/environment-draft";

describe("local environment drafts", () => {
  it("marks local branch, run command, and setup edits dirty without producing a save patch until requested", () => {
    const baseline = normalizeLocalEnvironmentDraft({
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });
    const draft = normalizeLocalEnvironmentDraft({
      defaultBranch: "release",
      setupScript: "pnpm install\npnpm build",
      runCommand: "make dev",
    });

    expect(isLocalEnvironmentDraftDirty(draft, baseline)).toBe(true);
    expect(buildLocalEnvironmentSavePatch(draft)).toEqual({
      defaultBranch: "release",
      setupScript: "pnpm install\npnpm build",
      runCommand: "make dev",
    });
  });

  it("reverts by restoring the persisted local baseline", () => {
    const baseline = normalizeLocalEnvironmentDraft({
      defaultBranch: " main ",
      setupScript: "uv sync",
      runCommand: "make dev",
    });

    expect(normalizeLocalEnvironmentDraft(baseline)).toEqual({
      defaultBranch: "main",
      setupScript: "uv sync",
      runCommand: "make dev",
    });
    expect(isLocalEnvironmentDraftDirty(baseline, baseline)).toBe(false);
  });
});
