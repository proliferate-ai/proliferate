import type { SessionStreamConnectionState } from "@/lib/domain/sessions/directory/directory-entry";

export interface PromptableSessionSlotSnapshot {
  transcriptHydrated: boolean;
  streamConnectionState: SessionStreamConnectionState;
}

export function canPromptSessionSlot(slot: PromptableSessionSlotSnapshot): boolean {
  return slot.transcriptHydrated || slot.streamConnectionState === "open";
}
