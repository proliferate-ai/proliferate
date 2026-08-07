/**
 * The one expanded toast, held outside React so the exclusive-expansion rule
 * can span the whole rendered stack: a single id is the whole state, so
 * opening details on one toast structurally collapses any other. Held outside
 * the bodies because `showToast` — a plain function callable from anywhere —
 * also has to collapse on dismissal, and Retry collapses on the way out.
 */
let expandedToastId: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToastExpansion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readExpandedToastId(): string | null {
  return expandedToastId;
}

export function toggleToastExpansion(id: string): void {
  expandedToastId = expandedToastId === id ? null : id;
  emit();
}

/** Collapse without knowing whether `id` is the expanded one — dismissal and
 * Retry call this unconditionally, and a no-op stays silent. */
export function collapseToastExpansion(id: string): void {
  if (expandedToastId !== id) {
    return;
  }
  expandedToastId = null;
  emit();
}
