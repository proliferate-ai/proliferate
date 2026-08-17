/**
 * Authored strings for the Workflows gen-2 builder. Kept beside
 * `workflow-trigger-copy.ts` under the same rule that file follows: authored
 * text is copy, not presentation logic.
 *
 * The factories here are the sanctioned kind — the caller already decided the
 * value (a step's position, a slug, a validator's first message) and this file
 * only decides the words around it.
 */
export const WORKFLOW_BUILDER_COPY = {
  backLabel: "Back",
  saveLabel: "Save Workflow",
  savingLabel: "Saving",
  savedLabel: "Saved",

  loadingTitle: "Loading workflow",
  loadingDescription: "Loading this workflow's definition.",
  missingTitle: "Workflow not found",
  missingDescription: "It may have been deleted, or you may not have access to it.",
  unsupportedTitle: "Not editable here",
  unsupportedDescription:
    "This workflow was authored on the earlier stage-based format. Open it in the classic editor instead.",

  detailsHeading: "Details",
  titleLabel: "Workflow title",
  titlePlaceholder: "untitled_workflow",
  confirmTitleLabel: "Confirm name",
  descriptionLabel: "Description",
  descriptionPlaceholder: "What this workflow does and when to run it.",
  defaultRepositoryLabel: "Default repository",
  defaultRepositoryPlaceholder: "Ask at launch",
  defaultRepositoryHelp:
    "Where runs of this workflow start. Leave it unset and each run picks a repository instead.",
  defaultRepositoryUnavailableOption: (repoRootId: string) =>
    `Saved repository unavailable (${repoRootId})`,
  defaultRepositoryUnavailableHint:
    "This workflow's saved repository is not one this runtime lists. Pick a listed repository, or clear it, before saving.",
  repositoriesLoadFailed:
    "Repositories could not be loaded from the runtime. Reconnect to change this workflow's default repository.",

  catalogUnavailable:
    "The agent catalog could not be loaded. Steps save without a model and use the run's default.",

  /** Accessible name of the pannable chain canvas. */
  chainCanvasLabel: "Workflow chain",
  /** A canvas card whose title is still blank. */
  canvasUntitledStep: "Untitled step",
  /** A step card's summary line while its prompt is still empty. */
  canvasNoPrompt: "No prompt written yet",

  /** The left rail's step palette. */
  addStepHeading: "Add step",
  addAgentStepLabel: "Agent",
  addAgentStepTitle: "Add an agent step",
  addHumanStepLabel: "Human in the loop",
  addHumanStepTitle: "Add a human-in-the-loop step",
  /** The left rail's context-docs section. */
  contextDocsHeading: "Context docs",
  contextDocsCount: (count: number) => (count === 1 ? "1 doc" : `${count} docs`),
  contextDocsEmpty: "Markdown notes every step in this workflow can read.",
  docUntitledRow: "untitled",

  /** The structural input node heading the chain. */
  inputNodeKindLabel: "Input",
  inputNodeTitle: "Inputs",
  inputNodeSubtitle: "Trigger payload entering the workflow",

  /** The canvas's bottom-left status readout. */
  statusSummary: (steps: number, nodes: number) =>
    `${steps} ${steps === 1 ? "step" : "steps"} · ${nodes} ${nodes === 1 ? "node" : "nodes"}`,
  statusValid: "Valid",
  statusMoreIssues: (count: number) => `+${count} more`,

  /** The top bar's destructive definition delete. */
  deleteDefinitionLabel: "Delete",
  deleteDefinitionTitle: "Delete this workflow definition",
  moveStepUpLabel: (position: number) => `Move step ${position} up`,
  moveStepDownLabel: (position: number) => `Move step ${position} down`,
  stepTitleLabel: "Step name",
  stepTitlePlaceholder: "Draft the research questions",
  requiresApprovalLabel: "Requires human approval",
  modelSectionHeading: "Model",
  deleteNodeLabel: "Delete node",
  harnessDefaultOption: "Run default",
  modelLabel: "Model",
  modelHarnessDefaultOption: (harnessLabel: string) => `${harnessLabel} default`,
  modelUnavailableOption: (modelId: string) => `Unavailable model (${modelId})`,

  promptLabel: "Prompt",
  promptPlaceholder: "Investigate @input:goal and record what you find in @doc:findings.",
  inputsHeading: "Inputs",
  inputsDescription: "Values supplied when a run starts. Prompts read them as @input:name.",
  inputsEmpty: "This workflow takes no inputs.",
  addInputLabel: "Add input",
  removeInputLabel: (name: string) => `Remove input ${name}`,
  inputNameLabel: "Name",
  inputNamePlaceholder: "goal",
  inputDescriptionLabel: "Description",
  inputDescriptionPlaceholder: "What this value is for.",
  inputRequiredLabel: "Required",

  docsNeedStep: "Add a step before adding a document.",
  addDocLabel: "Add document",
  removeDocLabel: (slug: string) => `Remove document ${slug}`,
  removeDocButtonLabel: "Remove doc",
  docKindLabel: "Markdown",
  docCloseLabel: "Close",
  docContentsLabel: "Contents",
  /** "Markdown · 12 words" — the doc's meta line under its slug. */
  docMeta: (words: number) => `Markdown · ${words} ${words === 1 ? "word" : "words"}`,
  docSlugLabel: "Slug",
  docSlugPlaceholder: "findings",
  docProducingNodeLabel: "Written by",
  docProducingNodePlaceholder: "Select a step",
  docProducingNodeOption: (position: number, title: string) =>
    title.trim().length > 0 ? `Step ${position} — ${title}` : `Step ${position}`,
  docProducingNodeUnavailableOption: (nodeId: string) => `Unavailable step (${nodeId})`,
  docBodyPlaceholder: "# Findings\n\n## Answers\n",
} as const;
