import { ActivityChips, GoalBar } from "@proliferate/ui";
import type { ReactNode } from "react";

const noop = () => {};

const CAPABILITIES = {
  supported: true,
  native: true,
  pause: true,
  setEditTranscriptRows: true,
};

const HANDLERS = {
  onEdit: noop,
  onPause: noop,
  onResume: noop,
  onClear: noop,
  onDismiss: noop,
};

const BASE_GOAL = {
  objective:
    "Get the transcript virtualization suite green on main without regressing the stick-to-bottom behaviour",
  nativeStatus: "active",
  tokenBudget: 400000,
  tokensUsed: 128400,
  timeUsedSeconds: 742,
  metReason: null,
  iterations: 11,
  native: true,
  updatedAtMs: 1715774400000,
};

// The bar docks directly on top of the composer, so each cell renders the
// composer lip underneath it — that's the edge its `rounded-t-xl` belongs to.
const Dock = ({ children }: { children: ReactNode }) => (
  <div className="w-full max-w-2xl">
    {children}
    <div className="rounded-b-xl border border-t-0 border-border bg-composer-background px-3 py-3.5 text-composer text-muted-foreground">
      Reply to the agent…
    </div>
  </div>
);

export const PursuingWithChips = () => (
  <Dock>
    <GoalBar
      goal={{ ...BASE_GOAL, status: "active" }}
      capabilities={CAPABILITIES}
      {...HANDLERS}
      chips={(
        <ActivityChips
          chips={[
            { kind: "loops", count: 2, liveCount: 2, label: "2 loops" },
            { kind: "terminals", count: 3, liveCount: 1, label: "3 terminals" },
            { kind: "agents", count: 1, liveCount: 1, label: "1 agent" },
          ]}
        />
      )}
    />
  </Dock>
);

export const PausedGoal = () => (
  <Dock>
    <GoalBar
      goal={{ ...BASE_GOAL, status: "paused", nativeStatus: "paused" }}
      capabilities={CAPABILITIES}
      {...HANDLERS}
    />
  </Dock>
);

export const EditingObjective = () => (
  <Dock>
    <GoalBar
      goal={{ ...BASE_GOAL, status: "active" }}
      capabilities={CAPABILITIES}
      defaultEditing
      {...HANDLERS}
    />
  </Dock>
);

export const ComposingNewGoal = () => (
  <Dock>
    <GoalBar
      goal={null}
      capabilities={CAPABILITIES}
      composing
      onCancelCompose={noop}
      {...HANDLERS}
    />
  </Dock>
);

export const StoppedResult = () => (
  <Dock>
    <GoalBar
      goal={{
        ...BASE_GOAL,
        status: "failed",
        nativeStatus: "budgetLimited",
        tokensUsed: 400000,
      }}
      capabilities={CAPABILITIES}
      onSetNewGoal={noop}
      {...HANDLERS}
    />
  </Dock>
);
