import { getProliferateClient } from "./core";
import { subscribeCloudSse, type CloudSseSubscription } from "../streams/sse";
import type { CloudLivePatch, CloudLiveSubscriptionOptions } from "../types";

export interface SubscribeCloudLiveOptions<TPatch> extends CloudLiveSubscriptionOptions {
  onPatch: (patch: TPatch) => void;
  onError?: (error: Event) => void;
}

export function subscribeSession<TPayload = unknown>(
  sessionId: string,
  options: SubscribeCloudLiveOptions<CloudLivePatch<TPayload>>,
): CloudSseSubscription<CloudLivePatch<TPayload>> {
  const client = getProliferateClient();
  return subscribeCloudSse({
    url: client.buildUrl(`/v1/cloud/sessions/${encodeURIComponent(sessionId)}/stream`, {
      afterSeq: options.afterSeq ?? undefined,
    }),
    signal: options.signal,
    onEvent: options.onPatch,
    onError: options.onError,
  });
}

export function subscribeWorkspace<TPayload = unknown>(
  workspaceId: string,
  options: SubscribeCloudLiveOptions<CloudLivePatch<TPayload>>,
): CloudSseSubscription<CloudLivePatch<TPayload>> {
  const client = getProliferateClient();
  return subscribeCloudSse({
    url: client.buildUrl(`/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/stream`, {
      afterSeq: options.afterSeq ?? undefined,
    }),
    signal: options.signal,
    onEvent: options.onPatch,
    onError: options.onError,
  });
}

