import type { MockRun, MockScenario } from "./fixtures";
import { RunRow } from "./atoms";

export function MockRunsHistory({
  scenario,
  onOpenRun,
  onBack,
}: {
  scenario: MockScenario;
  onOpenRun: (run: MockRun) => void;
  onBack: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-6 py-8">
        <button
          type="button"
          onClick={onBack}
          className="w-fit pb-4 text-left text-xs text-faint transition-colors hover:text-muted-foreground"
        >
          Workflows / {scenario.definition.title}
        </button>
        <div className="flex items-baseline gap-2.5 pb-4">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Runs</h1>
          <span className="text-xs tabular-nums text-muted-foreground">{scenario.runs.length}</span>
        </div>
        {scenario.runs.length > 0 ? (
          <div className="flex flex-col border-t border-border">
            {scenario.runs.map((run) => (
              <RunRow key={run.invocationId} run={run} onOpen={() => onOpenRun(run)} />
            ))}
          </div>
        ) : (
          <p className="py-1 text-xs text-faint">No runs yet.</p>
        )}
      </div>
    </div>
  );
}
