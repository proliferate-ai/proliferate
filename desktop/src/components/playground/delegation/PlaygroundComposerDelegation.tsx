import { DelegatedWorkComposerControl } from "@/components/workspace/chat/input/delegated-work/DelegatedWorkComposerControl";
import { DelegatedWorkComposerPanel } from "@/components/workspace/chat/input/DelegatedWorkComposerPanel";
import type { ScenarioKey } from "@/config/playground";
import {
  PLAYGROUND_REVIEW_COMPOSER_STATES,
  PLAYGROUND_SUBAGENT_STRIP_ROWS,
  type PlaygroundReviewComposerState,
} from "@/lib/domain/chat/__fixtures__/playground/delegation-fixtures";
import { buildPlaygroundDelegatedWorkViewModel } from "@/components/playground/delegation/PlaygroundDelegatedWorkViewModel";

export function renderDelegationSlot(scenario: ScenarioKey) {
  const reviewState = reviewComposerStateForScenario(scenario);
  if (reviewState) {
    return (
      <DelegatedWorkComposerPanel>
        <DelegatedWorkComposerControl
          viewModel={buildPlaygroundDelegatedWorkViewModel({ reviewState })}
        />
      </DelegatedWorkComposerPanel>
    );
  }

  switch (scenario) {
    case "agents-cowork-only":
      return (
        <DelegatedWorkComposerPanel>
          <DelegatedWorkComposerControl
            viewModel={buildPlaygroundDelegatedWorkViewModel({ cowork: true })}
          />
        </DelegatedWorkComposerPanel>
      );
    case "subagents-composer-single":
      return (
        <PlaygroundDelegatedWorkControl
          subagentRows={PLAYGROUND_SUBAGENT_STRIP_ROWS
            .filter((row) => row.statusLabel === "Working")
            .slice(0, 1)}
        />
      );
    case "subagents-composer-few":
      return (
        <PlaygroundDelegatedWorkControl
          subagentRows={PLAYGROUND_SUBAGENT_STRIP_ROWS.slice(0, 3)}
        />
      );
    case "subagents-coding-review-with-approval":
      return <PlaygroundDelegationStack />;
    case "subagents-composer-many":
    case "subagents-queued-wake":
    case "subagents-queued-wake-with-approval":
      return (
        <PlaygroundDelegatedWorkControl subagentRows={PLAYGROUND_SUBAGENT_STRIP_ROWS} />
      );
    default:
      return null;
  }
}

function PlaygroundDelegationStack() {
  return (
    <DelegatedWorkComposerPanel>
      <DelegatedWorkComposerControl
        viewModel={buildPlaygroundDelegatedWorkViewModel({
          reviewState: PLAYGROUND_REVIEW_COMPOSER_STATES["subagents-reviewing-code"],
          cowork: true,
          subagentRows: PLAYGROUND_SUBAGENT_STRIP_ROWS,
        })}
      />
    </DelegatedWorkComposerPanel>
  );
}

function reviewComposerStateForScenario(
  scenario: ScenarioKey,
): PlaygroundReviewComposerState | null {
  return PLAYGROUND_REVIEW_COMPOSER_STATES[scenario] ?? null;
}

function PlaygroundDelegatedWorkControl({
  subagentRows,
}: {
  subagentRows: typeof PLAYGROUND_SUBAGENT_STRIP_ROWS;
}) {
  return (
    <DelegatedWorkComposerPanel>
      <DelegatedWorkComposerControl
        viewModel={buildPlaygroundDelegatedWorkViewModel({ subagentRows })}
      />
    </DelegatedWorkComposerPanel>
  );
}
