import type { PlaygroundScenarioSelection } from "@/config/playground";
import type { PlaygroundReplayState } from "@/hooks/playground/lifecycle/use-replay-session";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { PlaygroundRecordingTranscript } from "@/components/playground/transcript/PlaygroundRecordingTranscript";
import { renderPlaygroundPlanTranscript } from "@/components/playground/transcript/PlaygroundPlanTranscript";
import { renderPlaygroundReviewTranscript } from "@/components/playground/transcript/PlaygroundReviewTranscript";
import { renderPlaygroundStatusTranscript } from "@/components/playground/transcript/PlaygroundStatusTranscript";
import { renderPlaygroundToolTranscript } from "@/components/playground/transcript/PlaygroundToolTranscript";
import { PlaygroundLoadingStates } from "@/components/playground/loading/PlaygroundLoadingStates";

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

  const reviewTranscript = renderPlaygroundReviewTranscript(scenario);
  if (reviewTranscript) {
    return reviewTranscript;
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
