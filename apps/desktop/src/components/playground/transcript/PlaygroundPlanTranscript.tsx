import { useEffect, useState, type ReactNode } from "react";
import { AssistantMessage } from "@/components/workspace/chat/transcript/AssistantMessage";
import { CarryOutPlanRow } from "@/components/workspace/chat/transcript/CarryOutPlanRow";
import { ModeTransitionDivider } from "@/components/workspace/chat/transcript/ModeTransitionDivider";
import { ProposedPlanCard } from "@/components/workspace/chat/transcript/ProposedPlanCard";
import type { ScenarioKey } from "@/config/playground";
import {
  CARRY_OUT_PLAN_REFERENCE,
  CLAUDE_PLAN_LONG,
  CLAUDE_PLAN_SHORT,
} from "@/lib/domain/chat/__fixtures__/playground/plan-transcript-fixtures";
import { noop } from "@/components/playground/PlaygroundComposerActions";
import { TranscriptPreviewShell } from "@/components/playground/transcript/PlaygroundTranscriptShell";

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
    case "plan-streaming-upgrade":
      return <PlanStreamingUpgradePreview />;
    // Phase-divider rows for the three label shapes deriveModeSwitchDisplay
    // produces (both sides known / target only / nothing parseable).
    case "mode-transition":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="The plan is approved, so I'm leaving plan mode and starting the implementation." />
          <ModeTransitionDivider label="Plan mode → Default" />
          <AssistantMessage content="Edits apply directly from here. The rename is mechanical, so I'm switching to accept-edits for it." />
          <ModeTransitionDivider label="Accept edits mode" />
          <AssistantMessage content="This harness reports the switch without naming either side, so the divider falls back to the generic label." />
          <ModeTransitionDivider label="Mode changed" />
        </TranscriptPreviewShell>
      );
    // The full plan→execution receipt sequence: approved card, mode flip
    // divider, then the compact carry-out row instead of a third full copy of
    // the plan inside a canned user bubble.
    case "carry-out-plan":
      return (
        <TranscriptPreviewShell>
          <ProposedPlanCard
            content={CLAUDE_PLAN_SHORT}
            isStreaming={false}
            decisionState="approved"
            nativeResolutionState="none"
            decisionVersion={2}
            onImplementHere={noop}
          />
          <ModeTransitionDivider label="Plan mode → Default" />
          <CarryOutPlanRow plan={CARRY_OUT_PLAN_REFERENCE} />
          <AssistantMessage content="Starting with the onboarding copy: collapsing the three CLI steps into a single install step with a platform picker." />
        </TranscriptPreviewShell>
      );
    default:
      return null;
  }
}

// Chunk size is deliberately generous: browsers throttle timers in occluded
// tabs to ~1 tick/s, and the stream must still finish well before the cycle
// restarts so the upgrade moment is always reachable.
const PLAN_STREAM_INTERVAL_MS = 150;
/** Pause between the last streamed chunk and the decision upgrade. */
const PLAN_DECISION_DELAY_MS = 700;
const PLAN_CYCLE_RESTART_MS = 24_000;

/**
 * Streaming→decision in-place upgrade fixture: the plan body streams into the
 * footerless "streaming" card (same shell, no chip, no footer), then the
 * proposed_plan decision arrives and the status chip + Approve/Reject footer
 * appear in place — the card must not remount or swap chrome. Restarts every
 * 18s so the upgrade moment is repeatable.
 */
function PlanStreamingUpgradePreview() {
  const [cycle, setCycle] = useState(0);
  const [visibleLength, setVisibleLength] = useState(0);
  const [decisionState, setDecisionState] = useState<"streaming" | "pending">("streaming");

  useEffect(() => {
    setVisibleLength(0);
    setDecisionState("streaming");
    const interval = window.setInterval(() => {
      setVisibleLength((current) => {
        if (current >= CLAUDE_PLAN_SHORT.length) {
          return current;
        }
        return Math.min(CLAUDE_PLAN_SHORT.length, current + 24 + Math.floor(Math.random() * 72));
      });
    }, PLAN_STREAM_INTERVAL_MS);
    const restart = window.setTimeout(() => setCycle((value) => value + 1), PLAN_CYCLE_RESTART_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(restart);
    };
  }, [cycle]);

  const isComplete = visibleLength >= CLAUDE_PLAN_SHORT.length;
  useEffect(() => {
    if (!isComplete) {
      return;
    }
    const timer = window.setTimeout(
      () => setDecisionState("pending"),
      PLAN_DECISION_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [isComplete]);

  return (
    <ProposedPlanCard
      content={CLAUDE_PLAN_SHORT.slice(0, visibleLength)}
      isStreaming={decisionState === "streaming"}
      decisionState={decisionState}
      nativeResolutionState="none"
      decisionVersion={decisionState === "pending" ? 1 : null}
      onApprove={noop}
      onReject={noop}
    />
  );
}
