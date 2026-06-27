import { describe, expect, it } from "vitest";

import {
  anyHarnessGitBaseWorktreeDiffFilesKey,
  anyHarnessGitDiffKey,
  anyHarnessMarketplaceSkillsKey,
  anyHarnessMarketplaceSkillsScopeKey,
  anyHarnessSessionEventsKey,
  anyHarnessSkillsKey,
  anyHarnessWorkspaceSkillsKey,
} from "./query-keys.js";

describe("sdk-react query keys", () => {

  it("uses a session-events scope key for broad invalidation", () => {
    expect(
      anyHarnessSessionEventsKey("http://runtime.test", "workspace-1", "session-1"),
    ).toEqual([
      "anyharness",
      "http://runtime.test",
      "session",
      "workspace-1",
      "session-1",
      "events",
    ]);
  });

  it("includes every event request field that changes the result", () => {
    expect(
      anyHarnessSessionEventsKey(
        "http://runtime.test",
        "workspace-1",
        "session-1",
        12,
        100,
        8,
        6,
      ),
    ).toEqual([
      "anyharness",
      "http://runtime.test",
      "session",
      "workspace-1",
      "session-1",
      "events",
      {
        afterSeq: 12,
        beforeSeq: 8,
        limit: 100,
        turnLimit: 6,
      },
    ]);
  });

  it("keys base worktree file lists and per-file diffs by base ref", () => {
    expect(
      anyHarnessGitBaseWorktreeDiffFilesKey("http://runtime.test", "workspace-1", "origin/main"),
    ).toEqual([
      "anyharness",
      "http://runtime.test",
      "git-diff",
      "workspace-1",
      "base-worktree-files",
      "origin/main",
    ]);
    expect(
      anyHarnessGitDiffKey(
        "http://runtime.test",
        "workspace-1",
        "src/app.ts",
        "base_worktree",
        "origin/main",
        "src/old-app.ts",
      ),
    ).toEqual([
      "anyharness",
      "http://runtime.test",
      "git-diff",
      "workspace-1",
      "base_worktree",
      "origin/main",
      "src/old-app.ts",
      "src/app.ts",
    ]);
  });

  it("keys installed, marketplace, and workspace-local skills separately", () => {
    expect(anyHarnessSkillsKey(" http://runtime.test ")).toEqual([
      "anyharness",
      "http://runtime.test",
      "skills",
    ]);
    expect(anyHarnessMarketplaceSkillsScopeKey("http://runtime.test")).toEqual([
      "anyharness",
      "http://runtime.test",
      "skills",
      "marketplace",
    ]);
    expect(anyHarnessMarketplaceSkillsKey("http://runtime.test", " code review ", 5))
      .toEqual([
        "anyharness",
        "http://runtime.test",
        "skills",
        "marketplace",
        "code review",
        5,
      ]);
    expect(anyHarnessWorkspaceSkillsKey("http://runtime.test", "workspace-1"))
      .toEqual([
        "anyharness",
        "http://runtime.test",
        "skills",
        "workspace",
        "workspace-1",
      ]);
  });
});
