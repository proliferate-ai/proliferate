import { describe, expect, it } from "vitest";
import {
  normalizeRepoConfig,
  normalizeRepoConfigs,
} from "#product/lib/domain/preferences/repo-preferences";

describe("repo preferences", () => {
  it("normalizes persisted repo config values", () => {
    expect(normalizeRepoConfig({
      defaultBranch: " main ",
      setupScript: "pnpm install",
    })).toEqual({
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "",
      archiveScript: "",
      rerunSetupOnUnarchive: true,
    });
  });

  it("normalizes blank default branches to null", () => {
    expect(normalizeRepoConfig({
      defaultBranch: "  ",
      runCommand: "pnpm dev",
    })).toEqual({
      defaultBranch: null,
      setupScript: "",
      runCommand: "pnpm dev",
      archiveScript: "",
      rerunSetupOnUnarchive: true,
    });
  });

  it("normalizes keyed repo config maps", () => {
    expect(normalizeRepoConfigs({
      "/repo-a": { defaultBranch: " main " },
      "/repo-b": { setupScript: "uv sync", runCommand: "uv run pytest" },
    })).toEqual({
      "/repo-a": {
        defaultBranch: "main",
        setupScript: "",
        runCommand: "",
        archiveScript: "",
        rerunSetupOnUnarchive: true,
      },
      "/repo-b": {
        defaultBranch: null,
        setupScript: "uv sync",
        runCommand: "uv run pytest",
        archiveScript: "",
        rerunSetupOnUnarchive: true,
      },
    });
  });

  it("patches repo config while preserving omitted fields", () => {
    expect(normalizeRepoConfig({
      defaultBranch: " release ",
    }, {
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
      archiveScript: "scripts/archive.sh",
      rerunSetupOnUnarchive: false,
    })).toEqual({
      defaultBranch: "release",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
      archiveScript: "scripts/archive.sh",
      rerunSetupOnUnarchive: false,
    });
  });

  it("normalizes a persisted blob missing the archiving knobs to the defaults", () => {
    expect(normalizeRepoConfig({
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    })).toEqual({
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
      archiveScript: "",
      rerunSetupOnUnarchive: true,
    });
  });

  it("leaves existing archiving knobs intact when a patch omits them", () => {
    expect(normalizeRepoConfig({
      setupScript: "pnpm build",
    }, {
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
      archiveScript: "scripts/archive.sh",
      rerunSetupOnUnarchive: false,
    })).toEqual({
      defaultBranch: "main",
      setupScript: "pnpm build",
      runCommand: "pnpm dev",
      archiveScript: "scripts/archive.sh",
      rerunSetupOnUnarchive: false,
    });
  });
});
