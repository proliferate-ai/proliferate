import { useState, type ReactNode } from "react";
import { WorkflowDefinitionEditor } from "@proliferate/ui";

/**
 * The editor renders inside `ProductPageShell` (a `h-full flex-1 overflow-auto`
 * scroll viewport) and drives `WorkflowInputEditor` + `WorkflowStageEditor` off
 * a live agent catalog — so every cell bounds the pane and supplies a real
 * catalog, otherwise the harness/model/effort selects come up empty.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: 620 }}
    >
      {children}
    </div>
  );
}

const CATALOG = {
  catalogVersion: "2026-07-20",
  defaultAgentKind: "claude",
  agents: [
    {
      kind: "claude",
      displayName: "Claude Code",
      session: {
        supportsGoals: true,
        controls: [
          { key: "effort", mapping: { createField: "effort", liveConfigId: "effort" } },
        ],
        models: [
          {
            id: "claude-opus-4-6",
            displayName: "Claude Opus 4.6",
            defaultVisible: true,
            controls: { effort: { values: ["low", "medium", "high"] } },
          },
          {
            id: "claude-sonnet-4-6",
            displayName: "Claude Sonnet 4.6",
            defaultVisible: true,
            controls: { effort: { values: ["low", "medium", "high"] } },
          },
        ],
      },
    },
    {
      kind: "codex",
      displayName: "Codex",
      session: {
        supportsGoals: false,
        controls: [],
        models: [
          { id: "gpt-5-codex", displayName: "GPT-5 Codex", defaultVisible: true },
        ],
      },
    },
  ],
};

const REPOSITORIES = [
  { id: "repo-anyharness", label: "proliferate/anyharness" },
  { id: "repo-web", label: "proliferate/proliferate-web" },
  { id: "repo-docs", label: "proliferate/docs" },
];

const SAVED_DRAFT = {
  title: "Issue triage",
  description:
    "Reads a GitHub issue, reproduces it against the repo, and writes a diagnosis comment.",
  defaultRepoConfigId: "repo-anyharness",
  inputs: [
    { name: "ticket", type: "string", required: true },
    { name: "includeLogs", type: "boolean", required: false },
  ],
  stages: [
    {
      harnessConfig: { agentKind: "claude", modelId: "claude-opus-4-6", effort: "high" },
      steps: [
        {
          kind: "agent.prompt",
          prompt:
            "Reproduce {{inputs.ticket}} against the current checkout, then post a diagnosis.",
          goal: { objective: "Root-cause the reported failure" },
        },
      ],
    },
  ],
};

const EMPTY_DRAFT = {
  title: "",
  description: "",
  defaultRepoConfigId: null,
  inputs: [],
  stages: [
    {
      harnessConfig: { agentKind: "claude", modelId: null, effort: null },
      steps: [{ kind: "agent.prompt", prompt: "", goal: null }],
    },
  ],
};

const noop = () => undefined;

export const EditSavedWorkflow = () => {
  const [draft, setDraft] = useState(SAVED_DRAFT);
  return (
    <Frame>
      <WorkflowDefinitionEditor
        mode="edit"
        draft={draft}
        catalog={CATALOG}
        repositories={REPOSITORIES}
        issues={[]}
        onChange={setDraft}
        onSave={noop}
        onCancel={noop}
        onDelete={noop}
      />
    </Frame>
  );
};

export const CreateWorkflow = () => {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  return (
    <Frame>
      <WorkflowDefinitionEditor
        mode="create"
        draft={draft}
        catalog={CATALOG}
        repositories={REPOSITORIES}
        issues={[]}
        onChange={setDraft}
        onSave={noop}
        onCancel={noop}
      />
    </Frame>
  );
};

export const ValidationIssues = () => {
  const [draft, setDraft] = useState({ ...SAVED_DRAFT, title: "" });
  return (
    <Frame>
      <WorkflowDefinitionEditor
        mode="edit"
        draft={draft}
        catalog={CATALOG}
        repositories={REPOSITORIES}
        issues={[
          { path: "title", message: "Title is required." },
          {
            path: "stages.0.steps.0.prompt",
            message: "Prompt references an input that is not declared.",
          },
        ]}
        onChange={setDraft}
        onSave={noop}
        onCancel={noop}
        onDelete={noop}
      />
    </Frame>
  );
};

/**
 * The `catalogWarning` banner is deliberately not previewed: the editor paints
 * it as `text-warning`, and in this dark theme `--color-warning` is an alpha
 * FILL (15%) rather than an ink token, so the copy photographs blank. The
 * `serverError` banner is the same affordance on a readable token.
 */
export const ServerError = () => {
  const [draft, setDraft] = useState(SAVED_DRAFT);
  return (
    <Frame>
      <WorkflowDefinitionEditor
        mode="edit"
        draft={draft}
        catalog={CATALOG}
        repositories={REPOSITORIES}
        issues={[]}
        serverError="This workflow was changed elsewhere. Reload before saving."
        onChange={setDraft}
        onSave={noop}
        onCancel={noop}
        onReload={noop}
        onDelete={noop}
      />
    </Frame>
  );
};
