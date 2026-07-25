import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Select } from "@proliferate/ui/primitives/Select";
import { MOCK_SCENARIOS, type MockRun, type MockScreen } from "./fixtures";
import { MockWorkflowDetail } from "./MockWorkflowDetail";
import { MockRunsHistory } from "./MockRunsHistory";
import { MockRunDetail } from "./MockRunDetail";
import { MockStatesGallery } from "./MockStatesGallery";

/**
 * Fixture-driven mock of the Managed Workflow Product Experience (PR 6,
 * provisional). Three screens over one scenario's data: workflow detail,
 * definition-scoped history, and deep-linkable run detail — plus an
 * all-states audit gallery. No production APIs, routes, or stores.
 */
export function WorkflowsCoreV1Playground() {
  const [scenarioId, setScenarioId] = useState(MOCK_SCENARIOS[0]!.id);
  const scenario = MOCK_SCENARIOS.find((s) => s.id === scenarioId) ?? MOCK_SCENARIOS[0]!;
  const [gallery, setGallery] = useState(false);
  const [screen, setScreen] = useState<MockScreen>(scenario.initialScreen);
  const [openRunId, setOpenRunId] = useState<string | null>(
    scenario.initialScreen === "run" ? (scenario.runs[0]?.invocationId ?? null) : null,
  );

  function selectScenario(id: string) {
    const next = MOCK_SCENARIOS.find((s) => s.id === id) ?? MOCK_SCENARIOS[0]!;
    setGallery(false);
    setScenarioId(next.id);
    setScreen(next.initialScreen);
    setOpenRunId(next.initialScreen === "run" ? (next.runs[0]?.invocationId ?? null) : null);
  }

  function openRun(run: MockRun) {
    setOpenRunId(run.invocationId);
    setScreen("run");
  }

  const openRunFixture = scenario.runs.find((r) => r.invocationId === openRunId) ?? null;

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="shrink-0 font-mono text-xs text-faint">workflow mock</span>
        <Select
          value={gallery ? "" : scenario.id}
          onChange={(e) => selectScenario(e.target.value)}
          aria-label="Scenario"
          className="h-7 w-64 text-xs"
        >
          {gallery ? <option value="">— pick a scenario —</option> : null}
          {MOCK_SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
        <span className="min-w-0 flex-1 truncate text-xs text-faint" title={scenario.note}>
          {gallery ? "fixtures only · provisional presentation model" : scenario.note}
        </span>
        <Button
          variant="unstyled"
          size="unstyled"
          type="button"
          className={[
            "shrink-0 rounded-md px-2.5 py-1 text-xs transition-colors",
            gallery
              ? "bg-foreground/10 font-medium text-foreground"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          ].join(" ")}
          onClick={() => setGallery(true)}
        >
          All states
        </Button>
      </header>

      {gallery ? (
        <MockStatesGallery
          onOpenRun={({ scenario: next, run }) => {
            setGallery(false);
            setScenarioId(next.id);
            setOpenRunId(run.invocationId);
            setScreen("run");
          }}
        />
      ) : null}
      {!gallery && screen === "detail" ? (
        <MockWorkflowDetail
          key={scenario.id}
          scenario={scenario}
          onOpenRun={openRun}
          onOpenHistory={() => setScreen("history")}
        />
      ) : null}
      {!gallery && screen === "history" ? (
        <MockRunsHistory
          scenario={scenario}
          onOpenRun={openRun}
          onBack={() => setScreen("detail")}
        />
      ) : null}
      {!gallery && screen === "run" && openRunFixture ? (
        <MockRunDetail
          key={`${scenario.id}:${openRunFixture.invocationId}`}
          scenario={scenario}
          run={openRunFixture}
          onBack={() => setScreen("detail")}
        />
      ) : null}
    </div>
  );
}
