import type { Ref } from "react";
import { ChatComposerDock } from "#product/components/workspace/chat/input/ChatComposerDock";
import {
  PlaygroundComposerSurface,
  ReplayComposerSurface,
  renderComposerSurfaceForScenario,
} from "#product/components/playground/PlaygroundComposerSurfaces";
import { renderActiveSlot } from "#product/components/playground/composer-slots/PlaygroundActiveSlotFixtures";
import { renderAttachedSlot } from "#product/components/playground/composer-slots/PlaygroundAttachedSlotFixtures";
import { renderOutboundSlot } from "#product/components/playground/composer-slots/PlaygroundOutboundSlotFixtures";
import type { PlaygroundScenarioSelection } from "#product/config/playground";
import { useComposerDockSlots } from "#product/hooks/chat/ui/use-composer-dock-slots";
import type { PlaygroundReplayState } from "#product/hooks/playground/lifecycle/use-replay-session";

interface PlaygroundComposerProps {
  dockRef: Ref<HTMLDivElement>;
  lowerBackdropTopPx: number | null;
  selection: PlaygroundScenarioSelection;
  replay: PlaygroundReplayState;
}

export function PlaygroundComposer({
  dockRef,
  lowerBackdropTopPx,
  selection,
  replay,
}: PlaygroundComposerProps) {
  const replaySlots = useComposerDockSlots();
  const scenario = selection.kind === "fixture" ? selection.key : null;
  const outboundSlot = scenario ? renderOutboundSlot(scenario) : replaySlots.outboundSlot;
  const activeSlot = scenario ? renderActiveSlot(scenario) : replaySlots.activeSlot;
  const attachedSlot = scenario ? renderAttachedSlot(scenario) : replaySlots.attachedSlot;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <ChatComposerDock
        ref={dockRef}
        outboundSlot={outboundSlot ?? undefined}
        activeSlot={activeSlot ?? undefined}
        attachedSlot={attachedSlot ?? undefined}
        lowerBackdropTopPx={lowerBackdropTopPx}
        shellClassName="pointer-events-none absolute inset-x-0 bottom-0"
      >
        {selection.kind === "recording"
          ? <ReplayComposerSurface replay={replay} />
          : scenario
            ? renderComposerSurfaceForScenario(scenario)
            : <PlaygroundComposerSurface />}
      </ChatComposerDock>
    </div>
  );
}
