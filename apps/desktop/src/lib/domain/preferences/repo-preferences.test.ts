import { describe, expect, it } from "vitest";
import {
  normalizeRepoConfig,
  normalizeRepoConfigs,
} from "@/lib/domain/preferences/repo-preferences";

describe("repo preferences", () => {
  it("normalizes persisted repo config values", () => {
    expect(normalizeRepoConfig({
      defaultBranch: " main ",
      setupScript: "pnpm install",
    })).toEqual({
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "",
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
      },
      "/repo-b": {
        defaultBranch: null,
        setupScript: "uv sync",
        runCommand: "uv run pytest",
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
    })).toEqual({
      defaultBranch: "release",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });
  });
});
