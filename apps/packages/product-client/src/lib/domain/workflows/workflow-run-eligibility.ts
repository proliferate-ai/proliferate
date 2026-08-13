/** A reason a saved workflow cannot start a managed run yet. */
export interface WorkflowRunEligibilityBlockerView {
  code: string;
  path: string;
  message: string;
}
