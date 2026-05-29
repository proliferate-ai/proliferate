import { describe, expect, it } from "vitest";
import {
  DIFF_HARD_INLINE_BYTE_LIMIT,
  resolveDiffDisplayPolicy,
} from "./diff-display-policy";

describe("resolveDiffDisplayPolicy", () => {
  it("keeps normal source diffs renderable", () => {
    const policy = resolveDiffDisplayPolicy({
      path: "apps/desktop/src/components/workspace/git/GitPanel.tsx",
      additions: 8,
      deletions: 4,
      patch: "@@ -1 +1 @@\n-old\n+new",
    });

    expect(policy.kind).toBe("safe");
    expect(policy.shouldAutoCollapse).toBe(false);
    expect(policy.canFetchInline).toBe(true);
    expect(policy.canRenderInline).toBe(true);
  });

  it("collapses generated diffs without blocking explicit inline review", () => {
    const policy = resolveDiffDisplayPolicy({
      path: "anyharness/sdk/generated/openapi.json",
      additions: 10,
      deletions: 5,
    });

    expect(policy.kind).toBe("collapsedGenerated");
    expect(policy.shouldAutoCollapse).toBe(true);
    expect(policy.canFetchInline).toBe(true);
    expect(policy.canRenderInline).toBe(true);
  });

  it("blocks huge metadata-only diffs before fetching the patch", () => {
    const policy = resolveDiffDisplayPolicy({
      path: "anyharness/sdk/generated/openapi.json",
      additions: 0,
      deletions: 16_393,
    });

    expect(policy.kind).toBe("tooLargeInline");
    expect(policy.shouldAutoCollapse).toBe(true);
    expect(policy.canFetchInline).toBe(false);
    expect(policy.canRenderInline).toBe(false);
  });

  it("blocks patches that exceed the inline byte budget", () => {
    const policy = resolveDiffDisplayPolicy({
      path: "src/generated-client.ts",
      additions: 1,
      deletions: 1,
      patch: `@@ -1 +1 @@\n+${"x".repeat(DIFF_HARD_INLINE_BYTE_LIMIT + 1)}`,
    });

    expect(policy.kind).toBe("tooLargeInline");
    expect(policy.canRenderInline).toBe(false);
  });
});
