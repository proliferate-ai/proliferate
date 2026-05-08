import type {
  RuntimeInputSyncDescriptor,
  RuntimeInputSyncTrigger,
} from "@/lib/domain/cloud/runtime-input-sync";
import { normalizeRuntimeInputSyncDescriptor } from "@/lib/domain/cloud/runtime-input-sync";

export interface RuntimeInputSyncEvent {
  trigger: RuntimeInputSyncTrigger;
  descriptors: RuntimeInputSyncDescriptor[];
}

type RuntimeInputSyncListener = (event: RuntimeInputSyncEvent) => void;

const listeners = new Set<RuntimeInputSyncListener>();

export function subscribeRuntimeInputSyncEvents(
  listener: RuntimeInputSyncListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitRuntimeInputSyncEvent(event: RuntimeInputSyncEvent): void {
  const descriptors = event.descriptors.flatMap((descriptor) => {
    const normalized = normalizeRuntimeInputSyncDescriptor(descriptor);
    return normalized ? [normalized] : [];
  });
  if (descriptors.length === 0) {
    return;
  }
  for (const listener of listeners) {
    listener({
      trigger: event.trigger,
      descriptors,
    });
  }
}
