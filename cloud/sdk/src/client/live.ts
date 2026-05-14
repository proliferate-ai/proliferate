import { getProliferateClient } from "./core.js";
import { subscribeCloudSse, type CloudSseSubscription } from "../streams/sse.js";
import type { CloudLivePatch, CloudLiveSubscriptionOptions } from "../types/index.js";

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
    fetchResponse: ({ url, headers, signal }) =>
      client.streamRequest({ url, headers, signal }),
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
    fetchResponse: ({ url, headers, signal }) =>
      client.streamRequest({ url, headers, signal }),
    onEvent: options.onPatch,
    onError: options.onError,
  });
}
