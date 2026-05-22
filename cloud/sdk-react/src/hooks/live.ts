import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  getCommandStatus,
  subscribeSession,
  subscribeTarget,
  subscribeWorkspace,
  type CloudCommandResponse,
  type CloudSessionSnapshot,
  type CloudTargetDetail,
  type CloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk";
import {
  cloudCommandKey,
  cloudSessionSnapshotKey,
  cloudTargetKey,
  cloudWorkspaceSnapshotKey,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  isCloudCommandStatusPatch,
  isCloudHeartbeat,
  isCloudSessionProjectionPatch,
  isCloudSessionSnapshot,
  isCloudTargetPatch,
  isCloudTargetSnapshot,
  isCloudWorkspaceProjectionPatch,
  isCloudWorkspaceSnapshot,
  reduceSessionSnapshot,
  reduceWorkspaceSnapshot,
} from "./live-reducer.js";

const MIN_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 8_000;

export interface CloudLiveHookOptions {
  enabled?: boolean;
}

export interface UseSessionLiveOptions extends CloudLiveHookOptions {
  targetId: string | null;
}

export interface CloudLiveState<TSnapshot> {
  snapshot: TSnapshot | undefined;
  lastPatchAt: Date | undefined;
  isConnected: boolean;
  error: Error | undefined;
}

export interface CloudTargetLiveState extends CloudLiveState<{ target: CloudTargetDetail }> {}

export function useSessionLive(
  sessionId: string | null,
  options: UseSessionLiveOptions,
): CloudLiveState<CloudSessionSnapshot> {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<CloudLiveState<CloudSessionSnapshot>>(emptyLiveState);
  const cursorRef = useRef(0);
  const targetId = options.targetId;
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled || !sessionId || !targetId) {
      setState(emptyLiveState());
      cursorRef.current = 0;
      return;
    }

    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let subscription: { close: () => void } | undefined;

    const connect = () => {
      if (!active) {
        return;
      }
      subscription?.close();
      subscription = subscribeSession(
        sessionId,
        {
          targetId,
          afterSeq: cursorRef.current,
          onEvent(event) {
            if (!active) {
              return;
            }
            if (isCloudHeartbeat(event)) {
              setState((current) => ({ ...current, isConnected: true, error: undefined }));
              return;
            }
            attempt = 0;
            if (isCloudSessionSnapshot(event)) {
              cursorRef.current = event.session.lastEventSeq;
              queryClient.setQueryData(cloudSessionSnapshotKey(targetId, sessionId), event);
              setState({
                snapshot: event,
                lastPatchAt: new Date(),
                isConnected: true,
                error: undefined,
              });
              return;
            }
            if (isCloudSessionProjectionPatch(event)) {
              cursorRef.current = Math.max(cursorRef.current, event.patch.seq);
              setState((current) => {
                const snapshot = reduceSessionSnapshot(current.snapshot, event);
                if (snapshot) {
                  queryClient.setQueryData(cloudSessionSnapshotKey(targetId, sessionId), snapshot);
                }
                return {
                  snapshot,
                  lastPatchAt: new Date(),
                  isConnected: true,
                  error: undefined,
                };
              });
              return;
            }
            if (isCloudCommandStatusPatch(event)) {
              queryClient.setQueryData(cloudCommandKey(event.command.commandId), event.command);
              setState((current) => ({ ...current, isConnected: true, error: undefined }));
            }
          },
          onError(error) {
            if (!active) {
              return;
            }
            setState((current) => ({
              ...current,
              isConnected: false,
              error: normalizeStreamError(error),
            }));
            reconnectTimer = setTimeout(connect, reconnectDelay(attempt++));
          },
        },
        client,
      );
    };

    connect();
    return () => {
      active = false;
      subscription?.close();
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
      }
    };
  }, [client, enabled, queryClient, sessionId, targetId]);

  return state;
}

export function useWorkspaceLive(
  workspaceId: string | null,
  options: CloudLiveHookOptions = {},
): CloudLiveState<CloudWorkspaceSnapshot> {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<CloudLiveState<CloudWorkspaceSnapshot>>(emptyLiveState);
  const cursorRef = useRef(0);
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled || !workspaceId) {
      setState(emptyLiveState());
      cursorRef.current = 0;
      return;
    }

    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let subscription: { close: () => void } | undefined;

    const connect = () => {
      if (!active) {
        return;
      }
      subscription?.close();
      subscription = subscribeWorkspace(
        workspaceId,
        {
          afterSeq: cursorRef.current,
          onEvent(event) {
            if (!active) {
              return;
            }
            if (isCloudHeartbeat(event)) {
              setState((current) => ({ ...current, isConnected: true, error: undefined }));
              return;
            }
            attempt = 0;
            if (isCloudWorkspaceSnapshot(event)) {
              cursorRef.current = Math.max(
                0,
                ...event.sessions.map((session) => session.lastEventSeq),
              );
              queryClient.setQueryData(cloudWorkspaceSnapshotKey(workspaceId), event);
              setState({
                snapshot: event,
                lastPatchAt: new Date(),
                isConnected: true,
                error: undefined,
              });
              return;
            }
            if (isCloudWorkspaceProjectionPatch(event)) {
              cursorRef.current = Math.max(cursorRef.current, event.patch.seq);
              setState((current) => {
                const snapshot = reduceWorkspaceSnapshot(current.snapshot, event);
                if (snapshot) {
                  queryClient.setQueryData(cloudWorkspaceSnapshotKey(workspaceId), snapshot);
                }
                return {
                  snapshot,
                  lastPatchAt: new Date(),
                  isConnected: true,
                  error: undefined,
                };
              });
            }
          },
          onError(error) {
            if (!active) {
              return;
            }
            setState((current) => ({
              ...current,
              isConnected: false,
              error: normalizeStreamError(error),
            }));
            reconnectTimer = setTimeout(connect, reconnectDelay(attempt++));
          },
        },
        client,
      );
    };

    connect();
    return () => {
      active = false;
      subscription?.close();
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
      }
    };
  }, [client, enabled, queryClient, workspaceId]);

  return state;
}

export function useTargetLive(
  targetId: string | null,
  options: CloudLiveHookOptions = {},
): CloudTargetLiveState {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<CloudTargetLiveState>(emptyLiveState);
  const cursorRef = useRef(0);
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled || !targetId) {
      setState(emptyLiveState());
      cursorRef.current = 0;
      return;
    }

    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let subscription: { close: () => void } | undefined;

    const connect = () => {
      if (!active) {
        return;
      }
      subscription?.close();
      subscription = subscribeTarget(
        targetId,
        {
          afterSeq: cursorRef.current,
          onEvent(event) {
            if (!active) {
              return;
            }
            if (isCloudHeartbeat(event)) {
              setState((current) => ({ ...current, isConnected: true, error: undefined }));
              return;
            }
            attempt = 0;
            if (isCloudTargetPatch(event)) {
              queryClient.setQueryData(cloudTargetKey(targetId), event.target);
              setState({
                snapshot: { target: event.target },
                lastPatchAt: new Date(),
                isConnected: true,
                error: undefined,
              });
              return;
            }
            if (isCloudTargetSnapshot(event)) {
              queryClient.setQueryData(cloudTargetKey(targetId), event.target);
              setState({
                snapshot: event,
                lastPatchAt: new Date(),
                isConnected: true,
                error: undefined,
              });
              return;
            }
            if (isCloudCommandStatusPatch(event)) {
              queryClient.setQueryData(cloudCommandKey(event.command.commandId), event.command);
              setState((current) => ({ ...current, isConnected: true, error: undefined }));
            }
          },
          onError(error) {
            if (!active) {
              return;
            }
            setState((current) => ({
              ...current,
              isConnected: false,
              error: normalizeStreamError(error),
            }));
            reconnectTimer = setTimeout(connect, reconnectDelay(attempt++));
          },
        },
        client,
      );
    };

    connect();
    return () => {
      active = false;
      subscription?.close();
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
      }
    };
  }, [client, enabled, queryClient, targetId]);

  return state;
}

export function useCommandStatus(commandId: string | null, options: CloudLiveHookOptions = {}) {
  const client = useCloudClient();
  return useQuery<CloudCommandResponse>({
    queryKey: cloudCommandKey(commandId),
    queryFn: () => getCommandStatus(commandId!, client),
    enabled: (options.enabled ?? true) && commandId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !["queued", "leased", "delivered"].includes(status) ? false : 2_000;
    },
  });
}

function emptyLiveState<TSnapshot>(): CloudLiveState<TSnapshot> {
  return {
    snapshot: undefined,
    lastPatchAt: undefined,
    isConnected: false,
    error: undefined,
  };
}

function reconnectDelay(attempt: number): number {
  const exponentialDelay = MIN_RECONNECT_DELAY_MS * 2 ** Math.min(attempt, 5);
  return Math.min(exponentialDelay, MAX_RECONNECT_DELAY_MS);
}

function normalizeStreamError(error: Event): Error {
  return new Error(error.type || "Cloud live stream disconnected.");
}

export type {
  CloudCommandStatusPatch,
  CloudLivePatch,
  CloudLiveSubscriptionOptions,
  CloudSessionProjectionPatch,
  CloudSessionLiveEvent,
  CloudTargetPatch,
  CloudTargetLiveEvent,
  CloudWorkspaceProjectionPatch,
  CloudWorkspaceLiveEvent,
} from "@proliferate/cloud-sdk";
export {
  subscribeSession,
  subscribeTarget,
  subscribeWorkspace,
} from "@proliferate/cloud-sdk";
