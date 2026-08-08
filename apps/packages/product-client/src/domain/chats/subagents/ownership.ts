/**
 * Ownership and close-attribution reads over the session-subagents read model.
 *
 * The endpoint returns OPEN link rows only, so a row that names a closer is a
 * close that has been REQUESTED and has not landed yet: the owner asked, and the
 * agent finishes its current step before the link closes. Once the close lands
 * the row leaves the list entirely, which is why these helpers never describe a
 * closed agent — that attribution belongs to the close receipt in the
 * transcript.
 */

export interface CloseAttributionFields {
  closedBySessionId?: string | null;
  closeReason?: string | null;
}

export function isCloseRequested(
  link: CloseAttributionFields | null | undefined,
): boolean {
  return !!link?.closedBySessionId?.trim();
}

export function closeRequestedLabel(
  link: CloseAttributionFields | null | undefined,
): string | null {
  if (!isCloseRequested(link)) {
    return null;
  }
  const reason = link?.closeReason?.trim();
  return reason ? `Closing · ${reason}` : "Closing";
}

/**
 * The three ownership states an agent row can be in. All three live on
 * `session_links`: a subagent is an unpromoted `subagent` row, a promoted agent
 * is the same row stamped `promotedAt`, and an owned peer is an `owned_agent`
 * row that was never anybody's subagent.
 *
 * Only the first is subordinate. The other two are top-level sessions their
 * owner can still close, which is why they must not render inside a parent's
 * subagent fanout.
 */
export type AgentOwnershipState = "subagent" | "promoted" | "owned_agent";

export function childOwnershipState(
  child: { promotedAt?: string | null } | null | undefined,
): AgentOwnershipState {
  return child?.promotedAt?.trim() ? "promoted" : "subagent";
}

export function isPromotedChild(
  child: { promotedAt?: string | null } | null | undefined,
): boolean {
  return childOwnershipState(child) === "promoted";
}

export function isSubordinateChild(
  child: { promotedAt?: string | null } | null | undefined,
): boolean {
  return childOwnershipState(child) === "subagent";
}
