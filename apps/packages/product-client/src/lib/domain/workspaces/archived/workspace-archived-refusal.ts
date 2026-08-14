import { AnyHarnessError } from "@anyharness/sdk";

const WORKSPACE_ARCHIVED_CODE = "WORKSPACE_ARCHIVED";

/**
 * The uniform `WORKSPACE_ARCHIVED` rule (§3.11): any route that spawns a
 * process or mutates the worktree of an archived workspace refuses with this
 * typed 409. Every receiving surface — session start/resume, terminal
 * create, setup start/rerun, command-run start, `worktree/restore` — reads
 * the same signal here, next to its existing failure handling, and answers
 * it the same way: refresh the workspace listing, raise NO failure toast.
 * The server state is correct; only the client was stale, because R7 hides
 * every archived entry point client-side and this is defense-in-depth for a
 * stale client or a raced request.
 */
export function isWorkspaceArchivedRefusal(error: unknown): boolean {
  return error instanceof AnyHarnessError && error.problem.code === WORKSPACE_ARCHIVED_CODE;
}
