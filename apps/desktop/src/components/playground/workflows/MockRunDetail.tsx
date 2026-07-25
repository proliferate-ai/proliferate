import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowUpRight } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import type { MockRun, MockScenario } from "./fixtures";
import { dimensionRows, runActions, runHeadline, stepDot } from "./presentation";
import { Disclosure, MonoDot, PlacementInline, PropertyRow, Section } from "./atoms";

/** The four provisional dimensions as quiet property rows. */
export function StateProperties({ run }: { run: MockRun }) {
  return (
    <div className="flex flex-col">
      {dimensionRows(run).map((row) => (
        <PropertyRow key={row.label} label={row.label} value={row.value} detail={row.detail} />
      ))}
    </div>
  );
}

/** One honest contextual line per special situation, or nothing. */
function ContextNote({ run, cancelRequested }: { run: MockRun; cancelRequested: boolean }) {
  const note =
    run.freshness === "target_lost"
      ? run.cancelRequestedAt
        ? "Target lost after the cancellation request. The final outcome is unknown."
        : "Target lost. The final outcome is unknown; this run cannot be retried."
      : run.freshness === "unreachable" && !run.lastObservedAt
        ? "Runtime unreachable; no execution observation yet."
        : run.cancelRequestedAt || cancelRequested
          ? "Cancellation is durable intent. A later truthful completion or failure may still win."
          : run.delivery === "prepared"
            ? "Delivery was never requested. Retrying reuses this run's invocation ID; no duplicate is created."
            : run.sessionAvailability === "unavailable"
              ? "The exact session for this run is no longer available. Its recorded outcome is unchanged."
              : null;
  if (!note) return null;
  return <p className="pt-2 text-xs text-muted-foreground">{note}</p>;
}

export function MockRunDetail({
  scenario,
  run,
  onBack,
}: {
  scenario: MockScenario;
  run: MockRun;
  onBack: () => void;
}) {
  const [cancelRequested, setCancelRequested] = useState(false);
  const headline = runHeadline(run);
  const actions = runActions(run);
  const cancelState =
    cancelRequested && actions.cancel === "available" ? "pending" : actions.cancel;
  const stage = scenario.definition.stages[0]!;
  const step = stage.steps[0]!;
  const argEntries = Object.entries(run.arguments);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-6 py-8">
        <button
          type="button"
          onClick={onBack}
          className="w-fit pb-4 text-left text-xs text-faint transition-colors hover:text-muted-foreground"
        >
          Workflows / {scenario.definition.title} /{" "}
          <span className="font-mono">{run.invocationId.slice(0, 8)}</span>
        </button>

        <div className="flex items-start justify-between gap-4 pb-1">
          <div className="flex items-center gap-2.5">
            <MonoDot kind={headline.dot} />
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {headline.label}
            </h1>
            {headline.suffix ? (
              <span className="pt-0.5 text-xs text-muted-foreground">{headline.suffix}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {actions.startDelivery ? (
              <Button variant="secondary" size="sm">
                Start delivery
              </Button>
            ) : null}
            {cancelState === "available" ? (
              <Button variant="ghost" size="sm" onClick={() => setCancelRequested(true)}>
                Cancel
              </Button>
            ) : null}
            {cancelState === "pending" ? (
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <MonoDot kind="pulsing" />
                Cancellation requested {run.cancelRequestedAt ?? "just now"}
              </span>
            ) : null}
            {actions.openSession === "available" ? (
              <Button variant="secondary" size="sm">
                <ArrowUpRight className="size-3.5" />
                Open session
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Started {run.createdAt}</span>
          <span aria-hidden className="text-faint">·</span>
          <span>Updated {run.updatedAt}</span>
          <span aria-hidden className="text-faint">·</span>
          <span>rev {scenario.definition.revision}</span>
          <span aria-hidden className="text-faint">·</span>
          <PlacementInline placement={run.placement} />
        </div>

        <ContextNote run={run} cancelRequested={cancelRequested} />

        <Section
          title="State"
          className="mt-6"
          aside={<span className="font-mono text-xs text-faint">provisional model</span>}
        >
          <StateProperties run={run} />
        </Section>

        <Section title="Session" className="mt-5">
          <div className="flex items-center gap-2 pb-1.5">
            <ProviderIcon kind={stage.agentKind} className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {stage.agentKind === "claude" ? "Claude" : "Codex"}
            </span>
            <span className="text-xs text-muted-foreground">
              · {stage.modelId ?? "target default"}
              {stage.effort ? ` · ${stage.effort} reasoning` : ""}
            </span>
            <span className="min-w-0 flex-1" />
            <span className="shrink-0 text-xs text-faint">one session</span>
          </div>
          <div className="flex h-9 items-center gap-3 border-t border-border px-1">
            <MonoDot kind={stepDot(run.step.status)} />
            <span className="w-28 shrink-0 text-sm text-foreground">
              {run.step.status.charAt(0).toUpperCase() + run.step.status.slice(1)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {step.prompt}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {run.step.finishedAt ?? run.step.startedAt ?? "not started"}
            </span>
          </div>
          {actions.openSession === "unavailable" ? (
            <p className="pt-2 text-xs text-faint">Open session is unavailable for this run.</p>
          ) : null}
        </Section>

        <div className="mt-6 flex flex-col gap-1 border-t border-border pt-4">
          <Disclosure
            label="Inputs"
            summary={`${argEntries.length} value${argEntries.length === 1 ? "" : "s"} · owner only`}
          >
            {argEntries.map(([name, value]) => (
              <PropertyRow key={name} label={name} value={String(value)} mono />
            ))}
            <span className="pt-1.5 text-xs text-faint">
              Frozen at launch. Values never appear in lists, logs, or notifications.
            </span>
          </Disclosure>
          <Disclosure label="Details" summary={run.invocationId.slice(0, 8)}>
            <PropertyRow label="Invocation" value={run.invocationId} mono />
            <PropertyRow label="State version" value={run.stateVersion} mono />
            {run.correlation ? (
              <>
                <PropertyRow label="Cloud workspace" value={run.correlation.cloudWorkspaceId} mono />
                <PropertyRow label="Workspace" value={run.correlation.anyharnessWorkspaceId} mono />
                <PropertyRow label="Session" value={run.correlation.sessionId} mono />
              </>
            ) : (
              <span className="py-1 text-xs text-faint">
                No workspace or session correlation recorded yet.
              </span>
            )}
            {run.failureCode ? (
              <PropertyRow label="Failure code" value={run.failureCode} mono />
            ) : null}
            {run.interruptionCode ? (
              <PropertyRow label="Interruption" value={run.interruptionCode} mono />
            ) : null}
          </Disclosure>
        </div>
      </div>
    </div>
  );
}
