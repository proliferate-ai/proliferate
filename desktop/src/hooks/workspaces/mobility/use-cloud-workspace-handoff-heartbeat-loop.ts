import { useEffect, useRef } from "react";
import { useCloudWorkspaceHandoffHeartbeatMutation } from "@/hooks/cloud/use-cloud-workspace-handoff-heartbeat-mutation";

const HEARTBEAT_INTERVAL_MS = 10_000;

export function useCloudWorkspaceHandoffHeartbeatLoop(args: {
  mobilityWorkspaceId: string | null;
  handoffOpId: string | null;
  enabled: boolean;
}) {
  const heartbeatMutation = useCloudWorkspaceHandoffHeartbeatMutation();
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!args.enabled || !args.mobilityWorkspaceId || !args.handoffOpId) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelled || inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      try {
        await heartbeatMutation.mutateAsync({
          mobilityWorkspaceId: args.mobilityWorkspaceId ?? "",
          handoffOpId: args.handoffOpId ?? "",
        });
      } catch {
        // The detail/list query path remains authoritative. If heartbeats
        // lapse long enough, the next detail refresh will surface failure.
      } finally {
        inFlightRef.current = false;
      }

      if (!cancelled) {
        timer = window.setTimeout(() => {
          void tick();
        }, HEARTBEAT_INTERVAL_MS);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    args.enabled,
    args.handoffOpId,
    args.mobilityWorkspaceId,
    heartbeatMutation,
  ]);
}
