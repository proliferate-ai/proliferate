import { ClaudePlanCard } from "@/components/workspace/chat/transcript/ClaudePlanCard";
import { CLAUDE_PLAN_LONG, CLAUDE_PLAN_SHORT } from "@/lib/domain/chat/__fixtures__/playground";
import type { ScenarioKey } from "@/config/playground";

interface PlaygroundTranscriptProps {
  scenario: ScenarioKey;
}

export function PlaygroundTranscript({ scenario }: PlaygroundTranscriptProps) {
  if (scenario === "claude-plan-short") {
    return <ClaudePlanCard content={CLAUDE_PLAN_SHORT} isStreaming={false} />;
  }
  if (scenario === "claude-plan-long") {
    return <ClaudePlanCard content={CLAUDE_PLAN_LONG} isStreaming={false} />;
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
