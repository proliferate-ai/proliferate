import type { SessionDirectoryEntry } from "#product/lib/domain/sessions/directory/directory-entry";

/**
 * A client-owned root session may exist before AnyHarness assigns its runtime
 * session id. `pending` is retained for older/pre-classification records, but
 * child sessions are materialized by their owning parent-session flow.
 */
export function isProjectedSessionMaterializationCandidate(
  session: SessionDirectoryEntry,
): boolean {
  return session.materializedSessionId === null
    && (
      session.sessionRelationship.kind === "root"
      || session.sessionRelationship.kind === "pending"
    );
}
