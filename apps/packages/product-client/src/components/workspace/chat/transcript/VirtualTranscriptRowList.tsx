import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  parseTranscriptVirtualizationMode,
  resolveTranscriptVirtualizationEnabled,
  TRANSCRIPT_VIRTUALIZATION_STORAGE_KEY,
  type TranscriptVirtualizationMode,
} from "#product/domain/chats/transcript/transcript-virtualization-config";
import type {
  TranscriptRowListBaseProps,
} from "#product/hooks/chat/ui/transcript-row-list-model";
import { FullTranscriptRowList } from "./FullTranscriptRowList";
import { VirtualizedTranscriptRowList } from "./VirtualizedTranscriptRowList";

const LEGACY_ENABLE_VIRTUALIZATION_STORAGE_KEY = "proliferate:enableTranscriptVirtualization";
const LEGACY_DISABLE_VIRTUALIZATION_STORAGE_KEY = "proliferate:disableTranscriptVirtualization";
// A confirmed blank range can still be a transient WebKit measurement state.
// Keep the readable full renderer up briefly, then give a fresh virtualizer one
// retry. A second failure remains on the safety renderer so a genuinely broken
// range cannot flash between implementations forever.
const VIRTUALIZER_FALLBACK_RETRY_DELAY_MS = 1_000;

export function VirtualTranscriptRowList(props: TranscriptRowListBaseProps) {
  const { activeSessionId, selectedWorkspaceId } = props;
  const [virtualizationMode] = useState(readTranscriptVirtualizationMode);
  // Auto uses one stable virtualized implementation from the first row onward.
  // This avoids both a threshold remount and the old false latch that left a
  // live session on the full-DOM path forever.
  const virtualizationEnabled = resolveTranscriptVirtualizationEnabled({
    mode: virtualizationMode,
  });
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const fallbackCountRef = useRef(0);
  useLayoutEffect(() => {
    fallbackCountRef.current = 0;
    setFallbackReason(null);
  }, [activeSessionId, selectedWorkspaceId]);

  const handleFallback = useCallback((reason: string) => {
    fallbackCountRef.current += 1;
    setFallbackReason(reason);
  }, []);

  useEffect(() => {
    if (!virtualizationEnabled || fallbackReason === null || fallbackCountRef.current !== 1) {
      return;
    }
    const retryTimer = window.setTimeout(() => {
      setFallbackReason(null);
    }, VIRTUALIZER_FALLBACK_RETRY_DELAY_MS);
    return () => window.clearTimeout(retryTimer);
  }, [fallbackReason, virtualizationEnabled]);

  if (!virtualizationEnabled || fallbackReason !== null) {
    return (
      <FullTranscriptRowList
        {...props}
        fallbackReason={fallbackReason}
        virtualizationMode={virtualizationMode}
      />
    );
  }

  return (
    <VirtualizedTranscriptRowList
      {...props}
      onFallback={handleFallback}
      virtualizationMode={virtualizationMode}
    />
  );
}

function readTranscriptVirtualizationMode(): TranscriptVirtualizationMode {
  if (typeof window === "undefined") {
    return "auto";
  }

  const explicitMode = window.localStorage.getItem(TRANSCRIPT_VIRTUALIZATION_STORAGE_KEY);
  if (explicitMode !== null) {
    return parseTranscriptVirtualizationMode(explicitMode);
  }

  if (window.localStorage.getItem(LEGACY_DISABLE_VIRTUALIZATION_STORAGE_KEY) === "1") return "off";
  if (window.localStorage.getItem(LEGACY_ENABLE_VIRTUALIZATION_STORAGE_KEY) === "1") {
    return "on";
  }
  return "auto";
}
