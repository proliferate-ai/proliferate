import { describe, expect, it } from "vitest";
import { workflowTriggerIdentityKey } from "#product/lib/domain/workflows/workflow-trigger-identity";

const input = {
  workflowDefinitionId: "definition-1",
  arguments: { alpha: "one", beta: 2 },
  placement: { repoConfigId: "repo-1", mode: "worktree" as const },
};

describe("workflowTriggerIdentityKey", () => {
  it("is stable across argument key order", () => {
    expect(workflowTriggerIdentityKey({
      ...input,
      arguments: { beta: 2, alpha: "one" },
    })).toBe(workflowTriggerIdentityKey(input));
  });

  it("changes for every field the control plane canonicalizes", () => {
    const base = workflowTriggerIdentityKey(input);
    expect(workflowTriggerIdentityKey({ ...input, workflowDefinitionId: "definition-2" }))
      .not.toBe(base);
    expect(workflowTriggerIdentityKey({
      ...input,
      placement: { repoConfigId: "repo-2", mode: "worktree" },
    })).not.toBe(base);
    expect(workflowTriggerIdentityKey({
      ...input,
      placement: { repoConfigId: "repo-1", mode: "repo_root" },
    })).not.toBe(base);
    expect(workflowTriggerIdentityKey({ ...input, arguments: { alpha: "two", beta: 2 } }))
      .not.toBe(base);
    expect(workflowTriggerIdentityKey({ ...input, arguments: { alpha: "one" } }))
      .not.toBe(base);
  });

  it("distinguishes an argument's JSON type, which the control plane also does", () => {
    expect(workflowTriggerIdentityKey({ ...input, arguments: { alpha: "one", beta: "2" } }))
      .not.toBe(workflowTriggerIdentityKey(input));
  });
});
