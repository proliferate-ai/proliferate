import { useMemo } from "react";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { buildComposerSessionControlGroups } from "@/lib/domain/chat/session-controls/composer-control-groups";
import { resolveReasoningEffortEmphasis } from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";

/**
 * Ultra tier (frontier model at its ultra reasoning level) tints the whole
 * composer border, not just the bars chip — resolved from the same shared
 * helper so surface and chip can't disagree.
 */
export function useComposerUltraEmphasis(
  controls: LiveSessionControlDescriptor[],
): boolean {
  return useMemo(() => {
    const effortControl = buildComposerSessionControlGroups(controls).reasoningEffortControl;
    return effortControl
      ? resolveReasoningEffortEmphasis(effortControl.options) === "ultra"
      : false;
  }, [controls]);
}
