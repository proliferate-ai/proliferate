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
  titlePlaceholder: "Issue triage",
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

  titleRequired: "Give this workflow a title before saving.",
  jsonInvalid: "The JSON view holds an invalid definition. Fix or revert it before saving.",
  issuesBanner: (count: number, firstMessage: string) =>
    `Fix ${count} ${count === 1 ? "issue" : "issues"} before saving. ${firstMessage}`,
  catalogUnavailable:
    "The agent catalog could not be loaded. Stored selections remain visible and cannot be saved until availability is known.",
  modelUnavailable:
    "A stored harness or model is unavailable. Choose an available selection or clear it before saving.",

  stepHeading: (position: number) => `Step ${position}`,
  /** Accessible name of the pannable chain canvas. */
  chainCanvasLabel: "Workflow chain",
  /** A canvas card whose title is still blank. */
  canvasUntitledStep: "Untitled step",
  /** The destructive mark on a canvas card the validator has an issue on. */
  canvasIssueMarkLabel: "This step has issues",

  /** The left rail's step palette. */
  addStepHeading: "Add step",
  addAgentStepLabel: "Agent",
  addHumanStepLabel: "Human in the loop",
  railHelp:
    "Connect ports to author the run path. Select a card to edit it; moving a card changes display order only.",

  /** The left rail's context-docs section. */
  contextDocsHeading: "Context docs",
  contextDocsCount: (count: number) => (count === 1 ? "1 doc" : `${count} docs`),
  contextDocsEmpty: "Documents steps write and later steps read.",
  docUntitledRow: "untitled",

  /** The structural input node heading the chain. */
  inputNodeKindLabel: "Input",
  inputNodeTitle: "Inputs",
  inputNodeSubtitle: "Trigger payload entering the workflow",

  /** The canvas's bottom-left status readout. */
  statusSummary: (steps: number, nodes: number) =>
    `${steps} ${steps === 1 ? "step" : "steps"} · ${nodes} ${nodes === 1 ? "node" : "nodes"}`,
  statusValid: "Valid",
  statusIssues: (count: number) => (count === 1 ? "1 issue" : `${count} issues`),
  removeStepLabel: (position: number) => `Remove step ${position}`,
  moveStepUpLabel: (position: number) => `Move step ${position} up`,
  moveStepDownLabel: (position: number) => `Move step ${position} down`,
  stepTitleLabel: "Title",
  stepTitlePlaceholder: "Draft the research questions",
  requiresApprovalLabel: "Requires human approval",
  harnessLabel: "Harness",
  harnessDefaultOption: "Run default",
  harnessUnavailableOption: (agentKind: string) => `Unavailable harness (${agentKind})`,
  modelLabel: "Model",
  modelDefaultOption: "Harness default",
  modelUnavailableOption: (modelId: string) => `Unavailable model (${modelId})`,

  promptLabel: "Prompt",
  promptPlaceholder: "Investigate @input:goal and record what you find in @doc:findings.",
  promptHelp:
    "Write @input:name to read a run value and @doc:slug to read or write a document. Both must be declared below.",
  promptPreviewLabel: "Prompt preview",
  resolvedReferenceHint: (raw: string) => `${raw} is declared`,
  unresolvedReferenceHint: (raw: string) => `${raw} is not declared yet`,
  /** `reason` is `describeMalformedReference`'s fragment, so the grammar is stated once. */
  malformedReferenceHint: (raw: string, reason: string) =>
    `${raw} is not a valid reference: ${reason}`,

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
  docSlugLabel: "Slug",
  docSlugPlaceholder: "findings",
  docProducingNodeLabel: "Written by",
  docProducingNodePlaceholder: "Select a step",
  docProducingNodeOption: (position: number, title: string) =>
    title.trim().length > 0 ? `Step ${position}: ${title}` : `Step ${position}`,
  docProducingNodeUnavailableOption: (nodeId: string) => `Unavailable step (${nodeId})`,
  docBodyLabel: "Starting body",
  docBodyPlaceholder: "# Findings\n\n## Answers\n",
} as const;
