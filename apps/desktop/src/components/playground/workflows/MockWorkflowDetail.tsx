import { useMemo, useState } from "react";
import { Input } from "@proliferate/ui/primitives/Input";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { CloudIcon } from "@proliferate/ui/icons";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import type { MockDefinition, MockRun, MockScenario } from "./fixtures";
import { computeEligibility } from "./presentation";
import { GHOST_FIELD, PlacementInline, RunRow, Section } from "./atoms";
import { MockPromptDocument } from "./MockPromptDocument";
import { MockRunBar, collectParams, paramError, seedArgs, type ArgValues } from "./MockRunBar";

/**
 * A workflow is a parameterized prompt. The page renders exactly that: the
 * prompt document as the hero (byline: harness · model · reasoning), the
 * derived signature as the run bar beneath it, then history. Everything
 * edits in place; eligibility recomputes live.
 */
export function MockWorkflowDetail({
  scenario,
  onOpenRun,
  onOpenHistory,
}: {
  scenario: MockScenario;
  onOpenRun: (run: MockRun) => void;
  onOpenHistory: () => void;
}) {
  const [definition, setDefinition] = useState<MockDefinition>(() =>
    structuredClone(scenario.definition),
  );
  const lastRun = scenario.runs[0];
  const prefilledFromLastRun = scenario.argPreset === "valid" && lastRun !== undefined;
  const [values, setValues] = useState<ArgValues>(() => {
    if (prefilledFromLastRun) {
      const seeded: ArgValues = {};
      for (const [name, value] of Object.entries(lastRun.arguments)) {
        seeded[name] = typeof value === "boolean" ? value : String(value);
      }
      return seeded;
    }
    return seedArgs(scenario.definition, scenario.argPreset);
  });
  const [showErrors, setShowErrors] = useState(scenario.argPreset === "invalid");

  const blockers = useMemo(() => computeEligibility(definition), [definition]);
  const params = useMemo(() => collectParams(definition), [definition]);

  function launch() {
    if (params.some((p) => paramError(p, values[p.name] ?? "") !== null)) {
      setShowErrors(true);
      return;
    }
    const focus = scenario.runs[0];
    if (focus) onOpenRun(focus);
  }

  const recent = scenario.runs.slice(0, 5);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-6 py-8">
        <span className="pb-4 text-xs text-faint">Workflows / {definition.title}</span>

        <Input
          value={definition.title}
          onChange={(e) => setDefinition({ ...definition, title: e.target.value })}
          aria-label="Workflow title"
          placeholder="Untitled workflow"
          className={twMerge(GHOST_FIELD, "h-auto py-0.5 text-lg font-semibold tracking-tight")}
        />
        <Textarea
          value={definition.description}
          onChange={(e) => setDefinition({ ...definition, description: e.target.value })}
          rows={1}
          aria-label="Workflow description"
          placeholder="What this workflow does"
          className={twMerge(
            GHOST_FIELD,
            "min-h-0 resize-none py-0.5 text-sm text-muted-foreground [field-sizing:content]",
          )}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CloudIcon className="size-3 text-faint" aria-hidden />
            Managed Cloud
          </span>
          <span aria-hidden className="text-faint">·</span>
          <PlacementInline placement={definition.placement} />
          <span aria-hidden className="text-faint">·</span>
          <span>rev {definition.revision}</span>
        </div>

        <div className="pt-7">
          <MockPromptDocument
            definition={definition}
            blockers={blockers}
            onChange={setDefinition}
          />
        </div>

        <Section
          title="Run"
          className="mt-6"
          aside={
            prefilledFromLastRun ? (
              <span className="text-xs text-faint">values from last run</span>
            ) : undefined
          }
        >
          <MockRunBar
            definition={definition}
            params={params}
            values={values}
            showErrors={showErrors}
            blockers={blockers}
            onChangeDefinition={setDefinition}
            onChangeValue={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
            onRun={launch}
          />
        </Section>

        <Section
          title="Runs"
          className="mt-7"
          aside={
            scenario.runs.length > 0 ? (
              <button
                type="button"
                onClick={onOpenHistory}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                View all →
              </button>
            ) : undefined
          }
        >
          {recent.length > 0 ? (
            <div className="flex flex-col">
              {recent.map((run) => (
                <RunRow key={run.invocationId} run={run} onOpen={() => onOpenRun(run)} />
              ))}
            </div>
          ) : (
            <p className="py-1 text-xs text-faint">No runs yet.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
