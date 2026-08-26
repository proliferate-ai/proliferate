# Runs Triage

Status: target. This document describes the accepted destination for the surface where a person sees every unit of agent work that is not the chat they are looking at — background subagents, goals and loops, workflow runs, scheduled/triggered runs, and their results — and acts on it. The body is written in the ideal state; every difference from `main` is in [Current gaps](#current-gaps). The ancestors on `main` are the activity chrome inside chat, the right-panel Background pane, the Agents pane, and the workflows main/run views.

## Purpose

One inbox for delegated work. A run is anything the product started on the person's behalf that produces a result: a subagent, a goal iteration, a loop fire, a workflow run, a triggered automation. Triage shows what is running, what finished, what needs a decision, and lets the person open the session behind it, approve, retry, or dismiss.

## Owned state

UI state only — filters, the selected run, dismissals, and the roster projection. Runs, results, and spawn trees are records owned by the runs system (control plane) and, for in-environment subagents, by the runtime's sessions.

## Public surface

- A `RunsTriage` screen at `/runs` (replacing today's `/workflows` main view
  and the Background pane), mounted in the sidebar page shell.
- An inbox count for the sidebar and the header activity indicator.
- A row component other surfaces embed: the chat transcript's "spawned
  N agents" ledger and the header tabs' subagent hierarchy render the same
  run row the inbox does.

## Consumes

- Runs system (control plane, via the public API): run list, run result,
  spawn tree, cancel-tree.
- Runtime sessions: subagent rosters and status (`useSessionSubagentsQuery`,
  `useWorkspaceSubagentsQuery`), goals and loops (`useSetSessionGoalMutation`,
  `useClearSessionGoalMutation`, loop actions), background command status.
- Workflows gen-2 (runtime): `useWorkflowRunsQuery`, `useWorkflowRunQuery`,
  `useWorkflowRunMutations` for run views and resume.
- Automations (control plane): definitions and invocations, for the trigger
  column.

## Laws

- **A run is a record before it is a process.** The inbox lists a run the
  moment it is created, before any environment exists, and keeps listing it
  after the environment is reaped.
- **Results are the unit of completion.** A run is "done" when its result
  is recorded; a session ending without a result is "stopped", shown
  distinctly.
- **Triage never executes.** Approve, retry, cancel, and open are requests
  to the owning system; the surface shows the owning system's answer.
- **Same row everywhere.** Chat, header tabs, and the inbox render one run
  row model; there is no second roster implementation.

## Emits

- Open-session navigation into the workspace surface.
- Approve / cancel / retry requests to the runs and integration-gateway
  systems.
- Inbox counts to the app sidebar.

## Fences

- **Chat** renders run rows inside a transcript but owns no run state
  ([../chat/README.md](../chat/README.md)).
- **Workspace surface** owns the right panel where the Background pane lives
  today ([../workspaces/README.md](../workspaces/README.md)).
- **Agents** owns delegated-work semantics and the Agents pane
  ([../agents/delegated-work.md](../subagents/delegated-work.md)).
- **Workflows** owns definitions and the builder; triage shows runs only
  ([WORKFLOWS.md](../automations/deep-dive.md)).

## Code map (ancestors on `main`)

```text
apps/packages/product-client/src/
├── domain/activity/                 goal, loop, process, subagent, background-work models   → systems/runs/domain
├── stores/activity/goal-bar-store.ts
├── hooks/activity/{derived,workflows,lifecycle}/   session activity, goal/loop actions, background pane
├── components/workspace/activity/   GoalBar*, LoopsPanel, SessionActivityBar, rosters, background-pane/
├── hooks/agents/facade/use-agents-pane.ts · components/workspace/delegated-work/agents-pane/
├── domain/workflows/{run-*,main-view-model}.ts · hooks/workflows/ · components/workflows/{main,run-view,trigger}/
├── components/workspace/chat/transcript/{GoalTranscriptEventRow,SubagentLaunchLedger,SpawnIdentityReceipt}.tsx
├── lib/access/anyharness/workflow-runs.ts
└── pages/WorkflowsPage.tsx          (`/workflows`; `/automations` is a legacy redirect in config/app-routes.ts)
```

## Proof (target)

- Unit: a row-model projection test per run kind; inbox filter and count
  tests.
- Contract: the run row model consumed by chat and header tabs is a single
  exported type with one test fixture set.
- Manual: the delegated-work and workflow rows of
  [manual-release-qa.md](../../engineering/testing/manual-release-qa.md).

## Current gaps

- No `/runs` route or inbox exists; `/workflows` shows gen-2 definitions and
  executions ([WorkflowsPage.tsx](../../../apps/packages/product-client/src/pages/WorkflowsPage.tsx)),
  and background work lives in the right panel
  ([BackgroundWorkPane.tsx](../../../apps/packages/product-client/src/components/workspace/activity/background-pane/BackgroundWorkPane.tsx)).
- Goals and loops are per-session runtime features rendered in the chat
  column ([GoalBar.tsx](../../../apps/packages/product-client/src/components/workspace/activity/GoalBar.tsx),
  [LoopsPanel.tsx](../../../apps/packages/product-client/src/components/workspace/activity/LoopsPanel.tsx));
  whether they survive as native-parity chrome or fold into runs is an open
  founder decision (cull plan decision ③).
- The runs system, run result primitive, and public API do not exist yet;
  until they do, the only run records are runtime sessions and gen-2
  workflow runs.
- The stranded automations client stack was deleted (#2216); the trigger
  column has no client ancestor.
- Three roster implementations exist (`AgentsRosterPanel`,
  `SubagentRosterRow`, `AgentsPaneRosterRow`) against the "same row
  everywhere" law.
