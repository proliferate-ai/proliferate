import type { ReactNode } from "react";
import { WorkflowDefinitionList } from "@proliferate/ui";

/**
 * The list renders inside `ProductPageShell`, a `h-full flex-1 overflow-auto`
 * scroll viewport — without a bounded parent it collapses to nothing, so every
 * cell supplies the sized pane the app route normally gives it.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: 600 }}
    >
      {children}
    </div>
  );
}

const DEFINITIONS = [
  {
    id: "wf-triage",
    title: "Issue triage",
    description:
      "Reads a GitHub issue, reproduces it against the repo, and writes a diagnosis comment.",
    stages: [{}, {}],
    inputs: [{}, {}],
    updatedAt: "2026-07-24T16:20:00Z",
  },
  {
    id: "wf-release-notes",
    title: "Release notes draft",
    description: "",
    stages: [{}],
    inputs: [{}, {}, {}],
    updatedAt: "2026-07-21T09:05:00Z",
  },
  {
    id: "wf-dep-bump",
    title: "Dependency bump sweep",
    description:
      "Bumps a named package across every workspace, runs the affected test suites, and opens one PR per repo.",
    stages: [{}, {}, {}],
    inputs: [{}],
    updatedAt: "2026-07-11T13:47:00Z",
  },
  {
    id: "wf-flaky",
    title: "Flaky test quarantine",
    description: "Re-runs a failing spec 20 times and quarantines it if it is non-deterministic.",
    stages: [{}],
    inputs: [{}, {}],
    updatedAt: "2026-06-30T22:14:00Z",
  },
];

export const Definitions = () => (
  <Frame>
    <WorkflowDefinitionList
      definitions={DEFINITIONS}
      onNew={() => undefined}
      onSelect={() => undefined}
    />
  </Frame>
);

export const NoWorkflowsYet = () => (
  <Frame>
    <WorkflowDefinitionList
      definitions={[]}
      onNew={() => undefined}
      onSelect={() => undefined}
    />
  </Frame>
);

export const Loading = () => (
  <Frame>
    <WorkflowDefinitionList
      definitions={[]}
      loading
      onNew={() => undefined}
      onSelect={() => undefined}
    />
  </Frame>
);

export const LoadFailed = () => (
  <Frame>
    <WorkflowDefinitionList
      definitions={[]}
      error="The live agent catalog could not be loaded."
      onNew={() => undefined}
      onSelect={() => undefined}
      onRetry={() => undefined}
    />
  </Frame>
);
