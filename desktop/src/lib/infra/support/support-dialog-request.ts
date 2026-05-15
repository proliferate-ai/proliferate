const SUPPORT_DIALOG_REQUEST_EVENT = "proliferate:support-dialog-request";

export function requestSupportDialog(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(SUPPORT_DIALOG_REQUEST_EVENT));
}

export function subscribeSupportDialogRequest(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(SUPPORT_DIALOG_REQUEST_EVENT, handler);
  return () => window.removeEventListener(SUPPORT_DIALOG_REQUEST_EVENT, handler);
}
