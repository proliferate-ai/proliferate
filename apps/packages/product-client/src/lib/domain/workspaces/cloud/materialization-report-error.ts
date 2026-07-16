import { ProliferateClientError } from "@proliferate/cloud-sdk";

/**
 * The server's stale-generation report rejection (PR 4 emits the RFC7807 code
 * ``stale_materialization_generation`` with a 409 when a report's generation is
 * behind the row's — including one bumped by a concurrent unlink or a newer
 * intent). This is NOT a materialization failure: the local worktree is fine;
 * the association simply moved on. The UI surfaces it as a distinct quiet state
 * rather than an error toast (PR5-STALE-07).
 */
export const STALE_MATERIALIZATION_GENERATION_CODE = "stale_materialization_generation";

export function isStaleMaterializationGenerationError(error: unknown): boolean {
  return (
    error instanceof ProliferateClientError
    && error.status === 409
    && error.code === STALE_MATERIALIZATION_GENERATION_CODE
  );
}
