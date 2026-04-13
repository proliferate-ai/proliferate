import { useMemo } from "react";
import {
  buildMobilityFooterContext,
  type MobilityFooterContext,
} from "@/lib/domain/workspaces/mobility-footer-context";
import { useWorkspaceMobilityState } from "./use-workspace-mobility-state";

export function useMobilityFooterContext(): MobilityFooterContext | null {
  const mobility = useWorkspaceMobilityState();

  return useMemo(() => buildMobilityFooterContext({
    logicalWorkspace: mobility.selectedLogicalWorkspace,
    status: mobility.status,
  }), [
    mobility.selectedLogicalWorkspace,
    mobility.status,
  ]);
}
