export interface ChangesMetadataFile {
  path: string;
  oldPath?: string | null;
  status: string;
  includedState?: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface ChangesMetadataPayload {
  files: readonly ChangesMetadataFile[];
  baseRef?: string | null;
  resolvedBaseOid?: string | null;
  mergeBaseOid?: string | null;
  headOid?: string | null;
}

export type ChangesEvidenceKind = "working_tree" | "branch" | "last_turn";

export function buildChangesMetadataFingerprint(
  metadata: ChangesMetadataPayload | null | undefined,
): string {
  const files = (metadata?.files ?? [])
    .map((file) => {
      const canonicalFile = {
        path: file.path,
        oldPath: file.oldPath ?? null,
        status: file.status,
        includedState: file.includedState ?? null,
        additions: file.additions,
        deletions: file.deletions,
        binary: file.binary,
      };
      return {
        file: canonicalFile,
        sortKey: stableFileIdentity(canonicalFile),
      };
    })
    .sort((left, right) => compareStableIdentity(left.sortKey, right.sortKey))
    .map((entry) => entry.file);
  return buildOpaqueFingerprint("changes-metadata-v1", {
    files,
    baseRef: metadata?.baseRef ?? null,
    resolvedBaseOid: metadata?.resolvedBaseOid ?? null,
    mergeBaseOid: metadata?.mergeBaseOid ?? null,
    headOid: metadata?.headOid ?? null,
  });
}

export function buildChangesCacheGeneration({
  kind,
  semanticFingerprint,
  observationToken,
  forceEpoch,
  completedTurnId = null,
}: {
  kind: ChangesEvidenceKind;
  semanticFingerprint: string;
  observationToken: number;
  forceEpoch: number;
  completedTurnId?: string | null;
}): string {
  return buildOpaqueFingerprint("changes-cache-v1", [
    kind,
    semanticFingerprint,
    observationToken,
    forceEpoch,
    kind === "last_turn" ? completedTurnId : null,
  ]);
}

export function buildChangesMetadataListCacheGeneration({
  forceEpoch,
  completedTurnId = null,
}: {
  forceEpoch: number;
  completedTurnId?: string | null;
}): string {
  return buildOpaqueFingerprint(
    "changes-metadata-list-v1",
    [forceEpoch, completedTurnId],
  );
}

function stableFileIdentity(file: {
  path: string;
  oldPath: string | null;
  status: string;
  includedState: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}): string {
  return JSON.stringify([
    file.path,
    file.oldPath,
    file.status,
    file.includedState,
    file.additions,
    file.deletions,
    file.binary,
  ]);
}

function compareStableIdentity(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function buildOpaqueFingerprint(namespace: string, value: unknown): string {
  const canonical = JSON.stringify(value);
  const hashes = [
    hashFingerprintPart(canonical, 0x811c9dc5),
    hashFingerprintPart(canonical, 0x9e3779b9),
    hashFingerprintPart(canonical, 0x85ebca6b),
    hashFingerprintPart(canonical, 0xc2b2ae35),
  ];
  return `${namespace}:${canonical.length.toString(36)}:${hashes.join("")}`;
}

function hashFingerprintPart(value: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0).toString(16).padStart(8, "0");
}
