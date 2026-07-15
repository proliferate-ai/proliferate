import { DelegatedWorkComposerControl } from "#product/components/workspace/chat/input/delegated-work/DelegatedWorkComposerControl";
import { DelegatedWorkComposerPanel } from "#product/components/workspace/chat/input/DelegatedWorkComposerPanel";
import type { ScenarioKey } from "#product/config/playground";
import {
  PLAYGROUND_SUBAGENT_STRIP_ROWS,
} from "#product/lib/domain/chat/__fixtures__/playground/delegation-fixtures";
import { buildPlaygroundDelegatedWorkViewModel } from "#product/components/playground/delegation/PlaygroundDelegatedWorkViewModel";

export function renderDelegationSlot(scenario: ScenarioKey) {
  switch (scenario) {
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
