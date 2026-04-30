import type { ReactNode } from "react";
import { useComposerDockSlots } from "@/hooks/chat/use-composer-dock-slots";

/**
 * Derives the inhabitant(s) of the single flex-col slot that sits above
 * the chat composer. When the durable prompt queue is non-empty, the
 * queue list is always rendered closest to the composer (visually at
 * the bottom of the stack). Above the queue, one of the existing
 * single-panel slots renders with the previous precedence:
 *
 *   1. Interaction card — FIFO permission/user input/MCP interaction is pending
 *   2. TodoTrackerPanel — Codex/Gemini structured_plan is active
 *   3. WorkspaceArrivalAttachedPanel — workspace status panel needs to show
 *   4. CloudRuntimeAttachedPanel     — cloud runtime is still connecting
 *   5. null                           — clean composer
 */
export function useComposerTopSlot(): ReactNode | null {
  const { upperSlot, subagentSlot, queueSlot } = useComposerDockSlots();

  if (!upperSlot && !subagentSlot && !queueSlot) {
    return null;
  }

  return (
    <>
      {upperSlot}
      {subagentSlot}
      {queueSlot}
    </>
  );
}
