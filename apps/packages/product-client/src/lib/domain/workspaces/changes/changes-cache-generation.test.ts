import { describe, expect, it } from "vitest";
import {
  buildChangesCacheGeneration,
  buildChangesMetadataFingerprint,
  buildChangesMetadataListCacheGeneration,
  type ChangesMetadataPayload,
} from "./changes-cache-generation";

const METADATA: ChangesMetadataPayload = {
  baseRef: "origin/main",
  resolvedBaseOid: "base-1",
  mergeBaseOid: "merge-1",
  headOid: "head-1",
  files: [
    {
      path: "src/b.ts",
      oldPath: null,
      status: "modified",
      includedState: "partial",
      additions: 2,
      deletions: 1,
      binary: false,
    },
    {
      path: "src/a.ts",
      oldPath: "src/old-a.ts",
      status: "renamed",
      includedState: "included",
      additions: 3,
      deletions: 4,
      binary: true,
    },
  ],
};

describe("changes cache generation", () => {
  it("fingerprints semantic metadata independently of file order", () => {
    const fingerprint = buildChangesMetadataFingerprint(METADATA);
    expect(fingerprint).toBe(
      buildChangesMetadataFingerprint({ ...METADATA, files: [...METADATA.files].reverse() }),
    );
    expect(fingerprint).not.toContain("src/a.ts");
    expect(fingerprint).not.toContain("origin/main");
  });

  it("keeps opaque fingerprints compact, stable, and distinct across a collision sample", () => {
    const fingerprint = buildChangesMetadataFingerprint(METADATA);
    expect(fingerprint).toMatch(/^changes-metadata-v1:[0-9a-z]+:[0-9a-f]{32}$/);
    expect(buildChangesMetadataFingerprint(METADATA)).toBe(fingerprint);
    const sample = Array.from({ length: 256 }, (_, index) => (
      buildChangesMetadataFingerprint(withFirstFile({ path: `src/sample-${index}.ts` }))
    ));
    expect(new Set(sample).size).toBe(sample.length);
  });

  it.each([
    ["path", withFirstFile({ path: "src/other.ts" })],
    ["old path", withFirstFile({ oldPath: "src/old.ts" })],
    ["status", withFirstFile({ status: "added" })],
    ["included state", withFirstFile({ includedState: "excluded" })],
    ["additions", withFirstFile({ additions: 9 })],
    ["deletions", withFirstFile({ deletions: 9 })],
    ["binary state", withFirstFile({ binary: true })],
    ["base ref", { ...METADATA, baseRef: "origin/release" }],
    ["head oid", { ...METADATA, headOid: "head-2" }],
    ["base oid", { ...METADATA, resolvedBaseOid: "base-2" }],
    ["merge-base oid", { ...METADATA, mergeBaseOid: "merge-2" }],
  ])("changes when %s changes", (_label, metadata) => {
    expect(buildChangesMetadataFingerprint(metadata)).not.toBe(
      buildChangesMetadataFingerprint(METADATA),
    );
  });

  it("composes metadata, observation, force epoch, evidence kind, and Last turn identity", () => {
    const semanticFingerprint = buildChangesMetadataFingerprint(METADATA);
    const generation = buildChangesCacheGeneration({
      kind: "last_turn",
      semanticFingerprint,
      observationToken: 1,
      forceEpoch: 1,
      completedTurnId: "turn-1",
    });
    expect(generation).not.toContain("turn-1");
    expect(generation).not.toContain("src/a.ts");
    expect(buildChangesCacheGeneration({
      kind: "last_turn",
      semanticFingerprint,
      observationToken: 1,
      forceEpoch: 2,
      completedTurnId: "turn-1",
    })).not.toBe(generation);
    expect(buildChangesCacheGeneration({
      kind: "last_turn",
      semanticFingerprint,
      observationToken: 1,
      forceEpoch: 1,
      completedTurnId: "turn-2",
    })).not.toBe(generation);
    expect(buildChangesCacheGeneration({
      kind: "branch",
      semanticFingerprint,
      observationToken: 1,
      forceEpoch: 1,
      completedTurnId: "turn-1",
    })).not.toBe(generation);
    expect(buildChangesCacheGeneration({
      kind: "last_turn",
      semanticFingerprint,
      observationToken: 2,
      forceEpoch: 1,
      completedTurnId: "turn-1",
    })).not.toBe(generation);
  });

  it("separates metadata-list identities at force and turn boundaries", () => {
    const first = buildChangesMetadataListCacheGeneration({
      forceEpoch: 1,
      completedTurnId: "turn-1",
    });
    expect(first).not.toContain("turn-1");
    expect(first).not.toBe(buildChangesMetadataListCacheGeneration({
      forceEpoch: 1,
      completedTurnId: "turn-2",
    }));
    expect(buildChangesMetadataListCacheGeneration({ forceEpoch: 1 })).not.toBe(
      buildChangesMetadataListCacheGeneration({ forceEpoch: 2 }),
    );
  });
});

function withFirstFile(
  change: Partial<ChangesMetadataPayload["files"][number]>,
): ChangesMetadataPayload {
  return {
    ...METADATA,
    files: [
      { ...METADATA.files[0]!, ...change },
      METADATA.files[1]!,
    ],
  };
}
