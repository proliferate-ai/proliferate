import type { PlaygroundScenarioSelection } from "#product/config/playground";
import type { PlaygroundReplayState } from "#product/hooks/playground/lifecycle/use-replay-session";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { PlaygroundRecordingTranscript } from "#product/components/playground/transcript/PlaygroundRecordingTranscript";
import { renderPlaygroundPlanTranscript } from "#product/components/playground/transcript/PlaygroundPlanTranscript";
import { renderPlaygroundStatusTranscript } from "#product/components/playground/transcript/PlaygroundStatusTranscript";
import { renderPlaygroundToolTranscript } from "#product/components/playground/transcript/PlaygroundToolTranscript";
import { PlaygroundLoadingStates } from "#product/components/playground/loading/PlaygroundLoadingStates";

interface PlaygroundTranscriptProps {
  stickyBottomInsetPx: number;
  selection: PlaygroundScenarioSelection;
  replay: PlaygroundReplayState;
}

export function PlaygroundTranscript({
  stickyBottomInsetPx,
  selection,
  replay,
}: PlaygroundTranscriptProps) {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);

  if (selection.kind === "recording") {
    return (
      <PlaygroundRecordingTranscript
        replay={replay}
        selectedWorkspaceId={selectedWorkspaceId}
        stickyBottomInsetPx={stickyBottomInsetPx}
      />
    );
  }

  const scenario = selection.key;
  if (scenario === "loading-states") {
    return <PlaygroundLoadingStates />;
  }

  const planTranscript = renderPlaygroundPlanTranscript(scenario);
  if (planTranscript) {
    return planTranscript;
  }

  const statusTranscript = renderPlaygroundStatusTranscript(scenario);
  if (statusTranscript) {
    return statusTranscript;
  }

  const toolTranscript = renderPlaygroundToolTranscript(
    scenario,
    selectedWorkspaceId,
    stickyBottomInsetPx,
  );
  if (toolTranscript) {
    return toolTranscript;
  }

  return (
    <div className="text-sm text-muted-foreground">
      <p className="leading-relaxed">
        This is the simulated transcript pane. Swap scenarios above to see
        different composer states and the Claude plan approval card.
      </p>
    </div>
  );
}
