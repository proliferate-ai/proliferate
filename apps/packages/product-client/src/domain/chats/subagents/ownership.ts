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
