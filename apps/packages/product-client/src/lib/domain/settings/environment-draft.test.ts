import { describe, expect, it } from "vitest";
import {
  buildLocalEnvironmentSavePatch,
  isLocalEnvironmentDraftDirty,
  normalizeLocalEnvironmentDraft,
} from "#product/lib/domain/settings/environment-draft";

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
      archiveScript: "",
      rerunSetupOnUnarchive: true,
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
      archiveScript: "",
      rerunSetupOnUnarchive: true,
    });
    expect(isLocalEnvironmentDraftDirty(baseline, baseline)).toBe(false);
  });

  it("carries both archiving knobs through normalization", () => {
    const draft = normalizeLocalEnvironmentDraft({
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
      archiveScript: "scripts/archive.sh",
      rerunSetupOnUnarchive: false,
    });

    expect(draft).toEqual({
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
      archiveScript: "scripts/archive.sh",
      rerunSetupOnUnarchive: false,
    });
  });

  it("reports dirty when only archiveScript differs", () => {
    const baseline = normalizeLocalEnvironmentDraft({
      archiveScript: "scripts/old.sh",
      rerunSetupOnUnarchive: true,
    });
    const draft = normalizeLocalEnvironmentDraft({
      archiveScript: "scripts/new.sh",
      rerunSetupOnUnarchive: true,
    });

    expect(isLocalEnvironmentDraftDirty(draft, baseline)).toBe(true);
  });

  it("reports dirty when only rerunSetupOnUnarchive differs", () => {
    const baseline = normalizeLocalEnvironmentDraft({
      archiveScript: "scripts/archive.sh",
      rerunSetupOnUnarchive: true,
    });
    const draft = normalizeLocalEnvironmentDraft({
      archiveScript: "scripts/archive.sh",
      rerunSetupOnUnarchive: false,
    });

    expect(isLocalEnvironmentDraftDirty(draft, baseline)).toBe(true);
  });
});
