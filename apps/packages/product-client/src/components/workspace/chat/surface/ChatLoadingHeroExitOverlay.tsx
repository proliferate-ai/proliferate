import { type JSX } from "react";
import { motion } from "@proliferate/design/motion";
import { DotCellLoader } from "#product/primitives/DotCellLoader";
import { ChatPreMessageCanvas } from "#product/components/workspace/chat/surface/ChatPreMessageCanvas";
import { WorkspaceCreationReceipt } from "#product/components/workspace/chat/transcript/WorkspaceCreationReceipt";
import type { ChatLoadingHeroExitPhase } from "#product/hooks/chat/ui/use-chat-loading-hero-exit";

/**
 * The frozen exit treatment `ChatContent` mounts on top of the already-resolved
 * content while `useChatLoadingHeroExit`'s hold/fade window is still open (R16).
 * A standalone `<DotCellLoader size="hero" />` rather than a live
 * `ChatLoadingHero`, so it doesn't re-derive from the session/workspace state
 * that already changed when `mode.kind` flipped away.
 */
export function ChatLoadingHeroExitOverlay({
  dockSafeAreaPx,
  phase,
}: {
  dockSafeAreaPx: number;
  phase: ChatLoadingHeroExitPhase;
}): JSX.Element {
  return (
    <div
      className="absolute inset-0"
      data-chat-loading-hero-exit
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transitionProperty: "opacity",
        transitionDuration: `${motion.duration.exitMs}ms`,
        transitionTimingFunction: motion.ease.standard,
        pointerEvents: "none",
      }}
    >
      <ChatPreMessageCanvas
        bottomInsetPx={dockSafeAreaPx}
        topSlot={<WorkspaceCreationReceipt pendingOnly />}
      >
        <div className="flex flex-col items-center text-center" data-chat-loading-hero>
          <DotCellLoader size="hero" />
        </div>
      </ChatPreMessageCanvas>
    </div>
  );
}
