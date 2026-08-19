import type { QueryClient } from "@tanstack/react-query";

interface ChangesMetadataObservation {
  forceEpoch: number;
  semanticFingerprint: string;
  token: number;
}

const observationsByQueryClient = new WeakMap<
  QueryClient,
  Map<string, ChangesMetadataObservation>
>();

export function observeChangesMetadata({
  queryClient,
  scopeKey,
  forceEpoch,
  semanticFingerprint,
}: {
  queryClient: QueryClient;
  scopeKey: string;
  forceEpoch: number;
  semanticFingerprint: string;
}): number {
  let observations = observationsByQueryClient.get(queryClient);
  if (!observations) {
    observations = new Map();
    observationsByQueryClient.set(queryClient, observations);
  }
  const current = observations.get(scopeKey);
  if (!current || current.forceEpoch !== forceEpoch) {
    observations.set(scopeKey, {
      forceEpoch,
      semanticFingerprint,
      token: 0,
    });
    return 0;
  }
  if (current.semanticFingerprint === semanticFingerprint) {
    return current.token;
  }
  const next = {
    forceEpoch,
    semanticFingerprint,
    token: current.token + 1,
  };
  observations.set(scopeKey, next);
  return next.token;
}
