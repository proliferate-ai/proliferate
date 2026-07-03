import { WorkflowStepCardFixtures } from "./WorkflowStepCardFixtures";
import { WorkflowRunTimelineFixtures } from "./WorkflowRunTimelineFixtures";

/**
 * Standalone dev surface for the Workflows UI building blocks (spec 3.6):
 * every step-card kind incl. the goal-attachment two-line treatment, the
 * editor rail chain, kind badges / glyph strips, and every run-timeline state.
 * Routed at /playground/workflows (DEV only).
 */
export function WorkflowsPlayground() {
  return (
    <div className="flex h-full w-full flex-col gap-12 overflow-auto bg-background p-8 text-foreground">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Workflows — component playground</h1>
        <p className="text-ui-sm text-muted-foreground">
          Fixture-only. Every step card, the goal two-line treatment, the editor rail chain, and
          all run-timeline states.
        </p>
      </header>
      <WorkflowStepCardFixtures />
      <WorkflowRunTimelineFixtures />
    </div>
  );
}
