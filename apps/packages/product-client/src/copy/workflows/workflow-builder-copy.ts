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
  newPageTitle: "New workflow",
  untitledPageTitle: "Untitled workflow",
  pageDescription:
    "One linear chain: each step runs after the one above it. Steps hand work forward through documents and read the values a run is started with.",
  backLabel: "Back",
  saveLabel: "Save",
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
  titleRequiredHint: "A title is required before this workflow can be saved.",
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

  issuesBanner: (count: number, firstMessage: string) =>
    `Fix ${count} ${count === 1 ? "issue" : "issues"} before saving. ${firstMessage}`,
  catalogUnavailable:
    "The agent catalog could not be loaded. Steps save without a model and use the run's default.",

  stepsHeading: "Steps",
  stepHeading: (position: number) => `Step ${position}`,
  addStepLabel: "Add step",
  removeStepLabel: (position: number) => `Remove step ${position}`,
  moveStepUpLabel: (position: number) => `Move step ${position} up`,
  moveStepDownLabel: (position: number) => `Move step ${position} down`,
  stepTitleLabel: "Title",
  stepTitlePlaceholder: "Draft the research questions",
  stepTypeLabel: "Run by",
  stepTypeAgent: "Agent",
  stepTypeHuman: "Human",
  humanStepNote: "The run pauses here until someone approves the step.",
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

  docsHeading: "Documents",
  docsDescription:
    "Shared documents steps write and later steps read. Prompts reference them as @doc:slug.",
  docsEmpty: "This workflow has no documents.",
  docsNeedStep: "Add a step before adding a document.",
  addDocLabel: "Add document",
  removeDocLabel: (slug: string) => `Remove document ${slug}`,
  docSlugLabel: "Slug",
  docSlugPlaceholder: "findings",
  docProducingNodeLabel: "Written by",
  docProducingNodePlaceholder: "Select a step",
  docProducingNodeOption: (position: number, title: string) =>
    title.trim().length > 0 ? `Step ${position} — ${title}` : `Step ${position}`,
  docProducingNodeUnavailableOption: (nodeId: string) => `Unavailable step (${nodeId})`,
  docBodyLabel: "Starting body",
  docBodyPlaceholder: "# Findings\n\n## Answers\n",
} as const;
