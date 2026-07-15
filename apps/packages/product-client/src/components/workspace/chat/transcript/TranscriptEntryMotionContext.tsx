import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import type { TranscriptState } from "@anyharness/sdk";

interface TranscriptEntryMotionRegistry {
  seenItemIds: Set<string>;
}

const TranscriptEntryMotionContext = createContext<TranscriptEntryMotionRegistry | null>(null);

/**
 * Session-scoped registry for one-shot live activity entrances. The provider
 * is keyed by workspace/session at the call site, seeds already-loaded items
 * as seen, and records every committed transcript item so history expansion,
 * virtualization, and session revisits never replay entrance motion.
 */
export function TranscriptEntryMotionProvider({
  transcript,
  children,
}: {
  transcript: TranscriptState;
  children: ReactNode;
}) {
  const [registry] = useState<TranscriptEntryMotionRegistry>(() => ({
    seenItemIds: new Set(Object.keys(transcript.itemsById)),
  }));

  useLayoutEffect(() => {
    for (const itemId of Object.keys(transcript.itemsById)) {
      registry.seenItemIds.add(itemId);
    }
  }, [registry, transcript]);

  return (
    <TranscriptEntryMotionContext.Provider value={registry}>
      {children}
    </TranscriptEntryMotionContext.Provider>
  );
}

export function useTranscriptEntryMotion(
  entryItemId: string | null,
  enabled: boolean,
): boolean {
  const registry = useContext(TranscriptEntryMotionContext);
  const [shouldAnimate] = useState(() => Boolean(
    registry
    && enabled
    && entryItemId
    && !registry.seenItemIds.has(entryItemId),
  ));

  useLayoutEffect(() => {
    if (registry && entryItemId) {
      registry.seenItemIds.add(entryItemId);
    }
  }, [entryItemId, registry]);

  return shouldAnimate;
}
