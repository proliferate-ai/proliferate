import { useLayoutEffect, useRef, useState } from "react";
import {
  parseTranscriptVirtualizationMode,
  resolveTranscriptVirtualizationEnabled,
  TRANSCRIPT_VIRTUALIZATION_STORAGE_KEY,
  type TranscriptVirtualizationMode,
} from "@proliferate/product-domain/chats/transcript/transcript-virtualization-config";
import type {
  TranscriptRowListBaseProps,
} from "./TranscriptRowListShared";
import { FullTranscriptRowList } from "./FullTranscriptRowList";
import { VirtualizedTranscriptRowList } from "./VirtualizedTranscriptRowList";

const LEGACY_ENABLE_VIRTUALIZATION_STORAGE_KEY = "proliferate:enableTranscriptVirtualization";
const LEGACY_DISABLE_VIRTUALIZATION_STORAGE_KEY = "proliferate:disableTranscriptVirtualization";

export function VirtualTranscriptRowList(props: TranscriptRowListBaseProps) {
  const { activeSessionId, rows, selectedWorkspaceId } = props;
  const [virtualizationMode] = useState(readTranscriptVirtualizationMode);
  // Latch the auto decision per session: swapping list implementations
  // mid-session remounts the whole transcript DOM, which reads as a full-page
  // jump right as a chat crosses the row threshold. A session that starts
  // small stays on the full list until re-entered; the full list stays
  // correct (just less efficient) at larger row counts.
  const latchedSessionRef = useRef<{ sessionId: string; enabled: boolean } | null>(null);
  const latched = latchedSessionRef.current;
  const virtualizationEnabled = latched?.sessionId === activeSessionId
    ? latched.enabled
    : resolveTranscriptVirtualizationEnabled({
        mode: virtualizationMode,
        rowCount: rows.length,
      });
  latchedSessionRef.current = { sessionId: activeSessionId, enabled: virtualizationEnabled };
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  useLayoutEffect(() => {
    setFallbackReason(null);
  }, [activeSessionId, selectedWorkspaceId]);

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
      onFallback={setFallbackReason}
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
