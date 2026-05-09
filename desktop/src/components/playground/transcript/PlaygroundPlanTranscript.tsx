import type { ReactNode } from "react";
import { ProposedPlanCard } from "@/components/workspace/chat/transcript/ProposedPlanCard";
import type { ScenarioKey } from "@/config/playground";
import {
  CLAUDE_PLAN_LONG,
  CLAUDE_PLAN_SHORT,
} from "@/lib/domain/chat/__fixtures__/playground";
import { noop } from "@/components/playground/PlaygroundComposerActions";

export function renderPlaygroundPlanTranscript(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "claude-plan-short":
      return (
        <ProposedPlanCard
          content={CLAUDE_PLAN_SHORT}
          isStreaming={false}
          decisionState="pending"
          nativeResolutionState="none"
          decisionVersion={1}
          onApprove={noop}
          onReject={noop}
        />
      );
    case "claude-plan-long":
      return (
        <ProposedPlanCard
          content={CLAUDE_PLAN_LONG}
          isStreaming={false}
          decisionState="approved"
          nativeResolutionState="finalized"
          decisionVersion={2}
          onImplementHere={noop}
        />
      );
    default:
      return null;
  }
}
