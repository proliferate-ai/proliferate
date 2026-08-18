/**
 * Authored strings for the gen-2 run view's graph node card and its two
 * dialogs (fail & redo, add ad hoc side node). Kept beside
 * `workflow-trigger-copy.ts` rather than inline, following the same rule that
 * copy follows the file, dialog copy included: `copy/**` owns human-facing
 * text, `run-view-model.ts` owns the eligibility logic that decides which of
 * these strings ever renders.
 *
 * `nodeIndexLabel` and `kindLine` are copy *factories*, not presentation
 * logic: the chain position and the defined/replacement/adhoc split are
 * already decided by the caller (`run-view-model.ts`'s `buildWorkflowGraph`),
 * so formatting them into a string is authored text, not a branch a component
 * should own.
 */
export const WORKFLOW_NODE_CARD_COPY = {
  /**
   * "03" — one-based, zero-padded to two digits, worn as the card's leading
   * index mark beside the title. A row with no chain position (contractually
   * impossible for a defined node, but a bad projection should stay visible
   * rather than throw) renders "--" instead of a bogus number.
   */
  nodeIndexLabel: (chainIndex: number | null): string =>
    chainIndex === null ? "--" : String(chainIndex + 1).padStart(2, "0"),
  /** "Agent" / "Human in the loop", annotated with why this row exists at all. */
  kindLine: (
    nodeType: "agent" | "human_in_loop",
    kind: "defined" | "replacement" | "adhoc",
  ): string => {
    const base = nodeType === "agent" ? "Agent" : "Human in the loop";
    if (kind === "replacement") return `${base} · Retry`;
    if (kind === "adhoc") return `${base} · Side node`;
    return base;
  },
  needsInputBadge: "Needs input",
  approveLabel: "Approve",
  failRedoLabel: "Fail & redo",
  flipToAgentLabel: "Make agent",
  flipToHumanLabel: "Make gate",
  addAdhocLabel: "Add side node",

  failRedoDialogTitle: "Fail & redo",
  failRedoDialogDescription:
    "Fails this node and starts a fresh attempt in its place. Edit the prompt before launch, or leave it as written.",
  failRedoPromptLabel: "Prompt",
  failRedoConfirmLabel: "Fail & redo",
  failRedoCancelLabel: "Cancel",

  addAdhocDialogTitle: "Add side node",
  addAdhocDialogDescription:
    "Runs alongside the chain, anchored to this node. It does not replace or block the node it is anchored to.",
  addAdhocPromptLabel: "Prompt",
  addAdhocPromptPlaceholder: "What should this side node do?",
  addAdhocConfirmLabel: "Add side node",
  addAdhocCancelLabel: "Cancel",
} as const;
