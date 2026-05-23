import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import { subscribeCloudSse, type CloudSseSubscription } from "../streams/sse.js";
import type {
  CloudCommandStatusPatch,
  CloudLiveSubscriptionOptions,
  CloudSessionLiveEvent,
  CloudSessionProjectionPatch,
  CloudTargetLiveEvent,
  CloudTargetPatch,
  CloudWorkspaceProjectionPatch,
  CloudWorkspaceLiveEvent,
} from "../types/index.js";

export interface SubscribeCloudLiveOptions<TEvent, TPatch = TEvent>
  extends CloudLiveSubscriptionOptions {
  onEvent?: (event: TEvent) => void;
  onPatch?: (patch: TPatch) => void;
  onError?: (error: Event) => void;
}

export interface SubscribeCloudSessionOptions
  extends SubscribeCloudLiveOptions<
    CloudSessionLiveEvent,
    CloudSessionProjectionPatch | CloudCommandStatusPatch
  > {
  targetId: string;
}

export function subscribeSession(
  sessionId: string,
  options: SubscribeCloudSessionOptions,
  client: ProliferateCloudClient = getProliferateClient(),
): CloudSseSubscription<CloudSessionLiveEvent> {
  const onEvent = liveEventHandler(options);
  return subscribeCloudSse({
    url: client.buildUrl(`/v1/cloud/sessions/${encodeURIComponent(sessionId)}/stream`, {
      targetId: options.targetId,
      afterSeq: options.afterSeq ?? undefined,
    }),
    signal: options.signal,
    fetchResponse: ({ url, headers, signal }) =>
      client.streamRequest({ url, headers, signal }),
    onEvent,
    onError: options.onError,
  });
}

export function subscribeWorkspace(
  workspaceId: string,
  options: SubscribeCloudLiveOptions<
    CloudWorkspaceLiveEvent,
    CloudWorkspaceProjectionPatch
  >,
  client: ProliferateCloudClient = getProliferateClient(),
): CloudSseSubscription<CloudWorkspaceLiveEvent> {
  const onEvent = liveEventHandler(options);
  return subscribeCloudSse({
    url: client.buildUrl(`/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/stream`, {
      afterSeq: options.afterSeq ?? undefined,
    }),
    signal: options.signal,
    fetchResponse: ({ url, headers, signal }) =>
      client.streamRequest({ url, headers, signal }),
    onEvent,
    onError: options.onError,
  });
}

export function subscribeTarget(
  targetId: string,
  options: SubscribeCloudLiveOptions<
    CloudTargetLiveEvent,
    CloudTargetPatch | CloudCommandStatusPatch
  >,
  client: ProliferateCloudClient = getProliferateClient(),
): CloudSseSubscription<CloudTargetLiveEvent> {
  const onEvent = liveEventHandler(options);
  return subscribeCloudSse({
    url: client.buildUrl(`/v1/cloud/targets/${encodeURIComponent(targetId)}/stream`, {
      afterSeq: options.afterSeq ?? undefined,
    }),
    signal: options.signal,
    fetchResponse: ({ url, headers, signal }) =>
      client.streamRequest({ url, headers, signal }),
    onEvent,
    onError: options.onError,
  });
}

function liveEventHandler<TEvent, TPatch>(
  options: SubscribeCloudLiveOptions<TEvent, TPatch>,
): (event: TEvent) => void {
  if (options.onEvent === undefined && options.onPatch === undefined) {
    throw new Error("Cloud live subscription requires onEvent or onPatch.");
  }
  return (event) => {
    options.onEvent?.(event);
    if (options.onPatch !== undefined && isCloudPatchEvent(event)) {
      options.onPatch(event as unknown as TPatch);
    }
  };
}

function isCloudPatchEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) {
    return false;
  }
  const kind = (event as { kind?: unknown }).kind;
  return (
    kind === "projection_patch" ||
    kind === "workspace_projection_patch" ||
    kind === "target_projection_patch" ||
    kind === "billing_patch" ||
    kind === "command_status"
  );
}
