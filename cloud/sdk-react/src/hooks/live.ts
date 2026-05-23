import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  getCommandStatus,
  subscribeSession,
  subscribeTarget,
  subscribeWorkspace,
  type CloudCommandResponse,
  type CloudCommandStatus,
  type CloudSessionSnapshot,
  type CloudTargetDetail,
  type CloudWorkspaceSnapshot,
  type ProliferateCloudClient,
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

interface CloudLiveInternalState<TSnapshot> extends CloudLiveState<TSnapshot> {
  client: ProliferateCloudClient | null;
  liveKey: string | null;
}

export function useSessionLive(
  sessionId: string | null,
  options: UseSessionLiveOptions,
): CloudLiveState<CloudSessionSnapshot> {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<CloudLiveInternalState<CloudSessionSnapshot>>(emptyLiveState);
  const cursorRef = useRef(0);
  const targetId = options.targetId;
  const enabled = options.enabled ?? true;
  const liveKey = sessionId && targetId ? `${sessionId}\0${targetId}` : null;

  useEffect(() => {
    if (!enabled || !sessionId || !targetId || !liveKey) {
      setState(emptyLiveState());
      cursorRef.current = 0;
      return;
    }

    setState(emptyLiveState(client, liveKey));
    cursorRef.current = 0;

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
              setState((current) => ({
                ...current,
                client,
                liveKey,
                isConnected: true,
                error: undefined,
              }));
              return;
            }
            attempt = 0;
            if (isCloudSessionSnapshot(event)) {
              cursorRef.current = event.session.lastEventSeq;
              queryClient.setQueryData(cloudSessionSnapshotKey(targetId, sessionId), event);
              setState({
                client,
                liveKey,
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
                  client,
                  liveKey,
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
              setState((current) => ({
                ...current,
                client,
                liveKey,
                isConnected: true,
                error: undefined,
              }));
            }
          },
          onError(error) {
            if (!active) {
              return;
            }
            setState((current) => ({
              ...current,
              client,
              liveKey,
              isConnected: false,
              error: normalizeStreamError(error),
            }));
            if (!isTerminalStreamError(error)) {
              reconnectTimer = setTimeout(connect, reconnectDelay(attempt++));
            }
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
  }, [client, enabled, liveKey, queryClient, sessionId, targetId]);

  return currentLiveState(state, client, liveKey);
}

export function useWorkspaceLive(
  workspaceId: string | null,
  options: CloudLiveHookOptions = {},
): CloudLiveState<CloudWorkspaceSnapshot> {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<CloudLiveInternalState<CloudWorkspaceSnapshot>>(emptyLiveState);
  const cursorRef = useRef(0);
  const enabled = options.enabled ?? true;
  const liveKey = workspaceId;

  useEffect(() => {
    if (!enabled || !workspaceId || !liveKey) {
      setState(emptyLiveState());
      cursorRef.current = 0;
      return;
    }

    setState(emptyLiveState(client, liveKey));
    cursorRef.current = 0;

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
              setState((current) => ({
                ...current,
                client,
                liveKey,
                isConnected: true,
                error: undefined,
              }));
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
                client,
                liveKey,
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
                  client,
                  liveKey,
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
              client,
              liveKey,
              isConnected: false,
              error: normalizeStreamError(error),
            }));
            if (!isTerminalStreamError(error)) {
              reconnectTimer = setTimeout(connect, reconnectDelay(attempt++));
            }
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
  }, [client, enabled, liveKey, queryClient, workspaceId]);

  return currentLiveState(state, client, liveKey);
}

export function useTargetLive(
  targetId: string | null,
  options: CloudLiveHookOptions = {},
): CloudTargetLiveState {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<CloudLiveInternalState<{ target: CloudTargetDetail }>>(
    emptyLiveState,
  );
  const cursorRef = useRef(0);
  const enabled = options.enabled ?? true;
  const liveKey = targetId;

  useEffect(() => {
    if (!enabled || !targetId || !liveKey) {
      setState(emptyLiveState());
      cursorRef.current = 0;
      return;
    }

    setState(emptyLiveState(client, liveKey));
    cursorRef.current = 0;

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
              setState((current) => ({
                ...current,
                client,
                liveKey,
                isConnected: true,
                error: undefined,
              }));
              return;
            }
            attempt = 0;
            if (isCloudTargetPatch(event)) {
              queryClient.setQueryData(cloudTargetKey(targetId), event.target);
              setState({
                client,
                liveKey,
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
                client,
                liveKey,
                snapshot: event,
                lastPatchAt: new Date(),
                isConnected: true,
                error: undefined,
              });
              return;
            }
            if (isCloudCommandStatusPatch(event)) {
              queryClient.setQueryData(cloudCommandKey(event.command.commandId), event.command);
              setState((current) => ({
                ...current,
                client,
                liveKey,
                isConnected: true,
                error: undefined,
              }));
            }
          },
          onError(error) {
            if (!active) {
              return;
            }
            setState((current) => ({
              ...current,
              client,
              liveKey,
              isConnected: false,
              error: normalizeStreamError(error),
            }));
            if (!isTerminalStreamError(error)) {
              reconnectTimer = setTimeout(connect, reconnectDelay(attempt++));
            }
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
  }, [client, enabled, liveKey, queryClient, targetId]);

  return currentLiveState(state, client, liveKey);
}

export function useCommandStatus(commandId: string | null, options: CloudLiveHookOptions = {}) {
  const client = useCloudClient();
  return useQuery<CloudCommandResponse>({
    queryKey: cloudCommandKey(commandId),
    queryFn: () => getCommandStatus(commandId!, client),
    enabled: (options.enabled ?? true) && commandId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTerminalCommandStatus(status) ? false : 1_000;
    },
  });
}

function isTerminalCommandStatus(status: CloudCommandStatus): boolean {
  return status === "accepted"
    || status === "accepted_but_queued"
    || status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

function emptyLiveState<TSnapshot>(
  client: ProliferateCloudClient | null = null,
  liveKey: string | null = null,
): CloudLiveInternalState<TSnapshot> {
  return {
    client,
    liveKey,
    snapshot: undefined,
    lastPatchAt: undefined,
    isConnected: false,
    error: undefined,
  };
}

function currentLiveState<TSnapshot>(
  state: CloudLiveInternalState<TSnapshot>,
  client: ProliferateCloudClient,
  liveKey: string | null,
): CloudLiveState<TSnapshot> {
  if (state.client !== client || state.liveKey !== liveKey) {
    return emptyLiveState();
  }
  return {
    snapshot: state.snapshot,
    lastPatchAt: state.lastPatchAt,
    isConnected: state.isConnected,
    error: state.error,
  };
}

function reconnectDelay(attempt: number): number {
  const exponentialDelay = MIN_RECONNECT_DELAY_MS * 2 ** Math.min(attempt, 5);
  return Math.min(exponentialDelay, MAX_RECONNECT_DELAY_MS);
}

function normalizeStreamError(error: Event): Error {
  const message = eventMessage(error);
  return new Error(message || error.type || "Cloud live stream disconnected.");
}

function isTerminalStreamError(error: Event): boolean {
  const status = eventStatus(error);
  return status === 401 || status === 403;
}

function eventMessage(error: Event): string | null {
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}

function eventStatus(error: Event): number | null {
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
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
