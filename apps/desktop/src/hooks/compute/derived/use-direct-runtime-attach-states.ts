import { useCallback } from "react";
import {
  directRuntimeConnectionKey,
  loopbackDirectRuntimeConnectionState,
  type DirectRuntimeConnectionState,
} from "@/lib/domain/compute/direct-runtime";
import { useDirectRuntimeConnectionStore } from "@/stores/compute/direct-runtime-connection-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

/**
 * Live attach state per direct runtime: loopback (targetId null) derives from
 * the harness bootstrap health, remote runtimes from the per-target attach
 * machine. Resolver form so list surfaces subscribe once for any number of
 * rows.
 */
export function useDirectRuntimeAttachStateResolver(): (
  targetId: string | null,
) => DirectRuntimeConnectionState {
  const loopbackState = useHarnessConnectionStore((state) => state.connectionState);
  const connectionsByKey = useDirectRuntimeConnectionStore(
    (state) => state.connectionsByKey,
  );
  return useCallback(
    (targetId: string | null) =>
      targetId === null
        ? loopbackDirectRuntimeConnectionState(loopbackState)
        : connectionsByKey[directRuntimeConnectionKey(targetId)]?.connectionState
          ?? "detached",
    [connectionsByKey, loopbackState],
  );
}

export function useDirectRuntimeAttachState(
  targetId: string | null,
): DirectRuntimeConnectionState {
  return useDirectRuntimeAttachStateResolver()(targetId);
}
