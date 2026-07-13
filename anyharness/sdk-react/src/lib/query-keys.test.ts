import { describe, expect, it } from "vitest";

import {
  anyHarnessGitBaseWorktreeDiffFilesKey,
  anyHarnessGitDiffKey,
  anyHarnessRuntimeHealthKey,
  anyHarnessSessionEventsKey,
  anyHarnessSessionsKey,
} from "./query-keys.js";

describe("sdk-react query keys", () => {

  it("uses a session-events scope key for broad invalidation", () => {
    expect(
      anyHarnessSessionEventsKey("http://runtime.test", "workspace-1", "session-1"),
    ).toEqual([
      "anyharness",
      "http://runtime.test",
      "workspace",
      "workspace-1",
      "session",
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
      "workspace",
      "workspace-1",
      "session",
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
      "workspace",
      "workspace-1",
      "git-diff",
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
      "workspace",
      "workspace-1",
      "git-diff",
      "base_worktree",
      "origin/main",
      "src/old-app.ts",
      "src/app.ts",
    ]);
  });

  it("separates runtime transport identity from the stable cache scope", () => {
    expect(anyHarnessRuntimeHealthKey("http://runtime-a.test", "api:user-1"))
      .toEqual([
        "anyharness",
        "api:user-1",
        "runtime",
        "http://runtime-a.test",
        "health",
      ]);
    expect(anyHarnessRuntimeHealthKey("http://runtime-b.test", "api:user-1"))
      .not
      .toEqual(anyHarnessRuntimeHealthKey("http://runtime-a.test", "api:user-1"));
  });

  it("keeps logical workspace keys independent of resolved gateway credentials", () => {
    expect(anyHarnessSessionsKey("api:user-1", "workspace-1")).toEqual([
      "anyharness",
      "api:user-1",
      "workspace",
      "workspace-1",
      "sessions",
    ]);
  });
});
