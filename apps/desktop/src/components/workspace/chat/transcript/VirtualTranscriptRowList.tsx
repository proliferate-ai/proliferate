import { useLayoutEffect, useState } from "react";
import {
  parseTranscriptVirtualizationMode,
  resolveTranscriptVirtualizationEnabled,
  TRANSCRIPT_VIRTUALIZATION_STORAGE_KEY,
  type TranscriptVirtualizationMode,
} from "@proliferate/product-domain/chats/transcript/transcript-virtualization-config";
import { FullTranscriptRowList } from "@/components/workspace/chat/transcript/FullTranscriptRowList";
import type {
  TranscriptRowListBaseProps,
} from "@/components/workspace/chat/transcript/TranscriptRowListShared";
import { VirtualizedTranscriptRowList } from "./VirtualizedTranscriptRowList";

const LEGACY_ENABLE_VIRTUALIZATION_STORAGE_KEY = "proliferate:enableTranscriptVirtualization";
const LEGACY_DISABLE_VIRTUALIZATION_STORAGE_KEY = "proliferate:disableTranscriptVirtualization";

export function VirtualTranscriptRowList(props: TranscriptRowListBaseProps) {
  const { activeSessionId, rows, selectedWorkspaceId } = props;
  const [virtualizationMode] = useState(readTranscriptVirtualizationMode);
  const virtualizationEnabled = resolveTranscriptVirtualizationEnabled({
    mode: virtualizationMode,
    rowCount: rows.length,
  });
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
