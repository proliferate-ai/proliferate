// Radix mounts every floating layer in a popper wrapper portal and marks open
// modal surfaces with data-state. Escape-scoped shortcuts (settings.back)
// check this so Escape peels the topmost layer — Radix closes the layer, the
// shortcut only fires when nothing dismissable is above the page. Radix does
// not preventDefault its Escape handling, so defaultPrevented alone cannot
// gate this.
export function hasOpenDismissableLayer(): boolean {
  return document.querySelector(
    '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  ) !== null;
}
