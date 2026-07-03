/**
 * Pure planning for the runtime -> cloud gateway-catalog mirror (P3 contract
 * §4): the runtime resolves its own gateway model plan per harness (contract
 * §5, read via `useAgentGatewayModelsQuery`/`useAgentGatewayModelsQueries`),
 * and the desktop forwards any FRESH probe result to the cloud mirror
 * endpoint (`useMirrorAgentCatalog`) — the runtime itself holds no cloud
 * session to push with directly.
 *
 * "Fresh" means: source is a live probe (not the catalog seed) AND its
 * `probedAt` hasn't already been mirrored for that harness kind.
 */

export interface GatewayModelsSnapshot {
  models: readonly string[];
  source: "seed" | "probe";
  probedAt?: string;
}

export interface GatewayMirrorPush {
  harnessKind: string;
  models: readonly string[];
  probedAt: string;
}

export function planGatewayCatalogMirrorPushes(input: {
  harnessKinds: readonly string[];
  /** Same length/order as `harnessKinds`; `undefined` = not loaded yet. */
  snapshots: ReadonlyArray<GatewayModelsSnapshot | undefined>;
  /** Last successfully-mirrored `probedAt` per harness kind. */
  lastMirroredProbedAt: ReadonlyMap<string, string>;
}): GatewayMirrorPush[] {
  const pushes: GatewayMirrorPush[] = [];
  input.harnessKinds.forEach((harnessKind, index) => {
    const snapshot = input.snapshots[index];
    if (!snapshot || snapshot.source !== "probe" || !snapshot.probedAt) {
      return;
    }
    if (input.lastMirroredProbedAt.get(harnessKind) === snapshot.probedAt) {
      return;
    }
    pushes.push({
      harnessKind,
      models: snapshot.models,
      probedAt: snapshot.probedAt,
    });
  });
  return pushes;
}
