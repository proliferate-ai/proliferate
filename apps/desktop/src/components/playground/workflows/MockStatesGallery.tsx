import { MOCK_SCENARIOS, type MockRun, type MockScenario } from "./fixtures";
import { runHeadline, runActions } from "./presentation";
import { MonoDot, RunRow, Section } from "./atoms";
import { StateProperties } from "./MockRunDetail";

interface GalleryEntry {
  scenario: MockScenario;
  run: MockRun;
}

const ENTRIES: GalleryEntry[] = MOCK_SCENARIOS.flatMap((scenario) => {
  const run = scenario.runs[0];
  return scenario.initialScreen === "run" && run ? [{ scenario, run }] : [];
});

function ActionsSummary({ run }: { run: MockRun }) {
  const actions = runActions(run);
  const parts: string[] = [];
  if (actions.startDelivery) parts.push("Start delivery");
  if (actions.cancel === "available") parts.push("Cancel");
  if (actions.cancel === "pending") parts.push("Cancellation requested (pending)");
  if (actions.openSession === "available") parts.push("Open session");
  if (actions.openSession === "unavailable") parts.push("Open session unavailable");
  return (
    <span className="text-xs text-faint">
      {parts.length > 0 ? parts.join(" · ") : "No actions"}
    </span>
  );
}

/** Candidate mono treatments for the interrupted dot — founder picks one. */
function InterruptedDotVariant({ variant }: { variant: "hollow" | "dashed" | "center" }) {
  if (variant === "hollow") {
    return <span className="size-2 rounded-full border border-current bg-transparent" />;
  }
  return (
    <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
      <circle
        cx="4"
        cy="4"
        r="3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeDasharray={variant === "dashed" ? "2 1.6" : undefined}
      />
      {variant === "center" ? <circle cx="4" cy="4" r="1.1" fill="currentColor" /> : null}
    </svg>
  );
}

function InterruptedDotOptions() {
  const options = [
    { id: "dashed", label: "B — dashed ring (applied)" },
    { id: "hollow", label: "A — hollow" },
    { id: "center", label: "C — ring + center dot" },
  ] as const;
  return (
    <div className="flex flex-col">
      {options.map((option) => (
        <div
          key={option.id}
          className="flex h-9 items-center gap-3 border-b border-border px-1 last:border-b-0"
        >
          <span className="inline-flex shrink-0 items-center text-muted-foreground">
            <InterruptedDotVariant variant={option.id} />
          </span>
          <span className="w-44 shrink-0 text-sm text-foreground">Interrupted</span>
          <span className="min-w-0 flex-1" />
          <span className="shrink-0 text-xs text-muted-foreground">{option.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Audit view: every distinct run state at once — the full row vocabulary in
 * one list, then each scenario's state properties with its caption.
 */
export function MockStatesGallery({ onOpenRun }: { onOpenRun: (entry: GalleryEntry) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-6 py-8">
        <h1 className="pb-5 text-lg font-semibold tracking-tight text-foreground">All states</h1>

        <Section title="Row vocabulary">
          <div className="flex flex-col">
            {ENTRIES.map((entry) => (
              <RunRow key={entry.scenario.id} run={entry.run} onOpen={() => onOpenRun(entry)} />
            ))}
          </div>
        </Section>

        <Section title="Interrupted dot — pick a treatment" className="mt-6">
          <InterruptedDotOptions />
        </Section>

        <Section title="State properties — one per scenario" className="mt-6">
          <div className="flex flex-col gap-6 pt-1">
            {ENTRIES.map((entry) => {
              const headline = runHeadline(entry.run);
              return (
                <div key={entry.scenario.id} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2">
                    <MonoDot kind={headline.dot} className="self-center" />
                    <span className="text-sm font-medium text-foreground">
                      {entry.scenario.label}
                    </span>
                    <span className="min-w-0 truncate text-xs text-faint">
                      {entry.scenario.note}
                    </span>
                  </div>
                  <StateProperties run={entry.run} />
                  <ActionsSummary run={entry.run} />
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}
