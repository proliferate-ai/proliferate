import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { observeChangesMetadata } from "./changes-cache-observation";
import { buildChangesMetadataFingerprint } from "#product/lib/domain/workspaces/changes/changes-cache-generation";

describe("observeChangesMetadata", () => {
  it("distinguishes an ABA sequence while unchanged query updates and remount reads stay stable", () => {
    const queryClient = new QueryClient();
    const metadataKey = ["metadata", "workspace-1"] as const;
    const m1 = metadata("modified");
    const m2 = metadata("added");

    queryClient.setQueryData(metadataKey, m1);
    const firstM1 = observeCurrent(queryClient, metadataKey);
    queryClient.setQueryData(metadataKey, { ...m1, files: [...m1.files] });
    const unchangedPoll = observeCurrent(queryClient, metadataKey);
    queryClient.setQueryData(metadataKey, m2);
    const observedM2 = observeCurrent(queryClient, metadataKey);
    queryClient.setQueryData(metadataKey, { ...m1, files: [...m1.files] });
    const finalM1 = observeCurrent(queryClient, metadataKey);

    expect([firstM1, unchangedPoll, observedM2, finalM1]).toEqual([0, 0, 1, 2]);
    expect(observeCurrent(queryClient, metadataKey)).toBe(finalM1);
  });
});

function observeCurrent(
  queryClient: QueryClient,
  metadataKey: readonly unknown[],
): number {
  return observeChangesMetadata({
    queryClient,
    scopeKey: "git-panel:workspace-1:working-tree",
    forceEpoch: 0,
    semanticFingerprint: buildChangesMetadataFingerprint(
      queryClient.getQueryData<ReturnType<typeof metadata>>(metadataKey),
    ),
  });
}

function metadata(status: string) {
  return {
    files: [{
      path: "src/app.ts",
      oldPath: null,
      status,
      includedState: "excluded",
      additions: 1,
      deletions: 1,
      binary: false,
    }],
  };
}
