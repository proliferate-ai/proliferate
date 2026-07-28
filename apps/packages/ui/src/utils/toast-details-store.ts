import type { ToastDetailsModalContent } from "../patterns/ToastDetailsModal";

/**
 * The one open details modal, held outside React so `showToast` — a plain
 * function callable from anywhere — can open it. `ToastHost` subscribes and
 * renders it; nothing else may.
 */
let openContent: ToastDetailsModalContent | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToastDetails(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readToastDetails(): ToastDetailsModalContent | null {
  return openContent;
}

export function openToastDetails(content: ToastDetailsModalContent): void {
  openContent = content;
  emit();
}

export function closeToastDetails(): void {
  openContent = null;
  emit();
}
