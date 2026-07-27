/**
 * Web-only pointers to the Desktop app.
 *
 * Web can only reach cloud machines, so a few surfaces would otherwise just be
 * missing options with no explanation. Each line states the one thing Desktop
 * adds, in the place the gap shows up. Keep them short and factual — this is a
 * capability note, not a pitch.
 */
export const DESKTOP_POINTER_COPY = {
  /** Footer of the sidebar create-workspace popover. */
  sidebarCreateWorkspace: "The Desktop app also runs workspaces on this machine.",
  /** Footer of the add-repository entry step. */
  addRepository: "To use a folder already on your machine, open the Desktop app.",
} as const;
