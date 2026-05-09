import type { PromptOutboxEntry } from "./prompt-outbox-model";

export function canRetryPromptOutboxEntry(entry: PromptOutboxEntry): boolean {
  return entry.deliveryState === "failed_before_dispatch";
}

export function canDismissPromptOutboxEntry(entry: PromptOutboxEntry): boolean {
  return entry.deliveryState === "failed_before_dispatch"
    || entry.deliveryState === "unknown_after_dispatch";
}

export function canCancelPromptOutboxEntryLocally(entry: PromptOutboxEntry): boolean {
  return entry.deliveryState === "waiting_for_session"
    || entry.deliveryState === "preparing";
}
