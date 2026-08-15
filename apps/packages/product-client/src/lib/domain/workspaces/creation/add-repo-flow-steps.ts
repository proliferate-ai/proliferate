/**
 * The add-repository flow's own vocabulary: which ways in a host offers, and
 * where in the flow it currently is.
 *
 * These live in the domain rather than on the popover because the flow is
 * driven from below — the controller hook and the flow store both name a step
 * and an option, and neither may reach up into a component to do it.
 */

/**
 * The host-truthful entry choices. `add-existing-folder` registers an existing
 * checkout on this machine (Desktop only); `clone-from-github` clones an
 * authorized GitHub repository to this machine (Desktop only, GitHub-App-ready);
 * `cloud` walks the readiness → repo picker → authority → save sequence (both
 * hosts).
 */
export type AddRepoFlowOption = "add-existing-folder" | "clone-from-github" | "cloud";

/** Which panel the flow is showing. */
export type AddRepoFlowStep =
  | { kind: "entry" }
  | { kind: "cloud" }
  | { kind: "clone" };
