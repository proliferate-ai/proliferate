import { useEffect, useMemo, useRef, useState } from "react";
import type { CloudPendingInteraction } from "@proliferate/cloud-sdk";
import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";

export function useMobileChatPermissionSheet({
  pendingPermissionByRequestId,
  visibleTranscriptRows,
}: {
  pendingPermissionByRequestId: ReadonlyMap<string, CloudPendingInteraction>;
  visibleTranscriptRows: readonly CloudChatTranscriptRowView[];
}) {
  const [toolDetailRow, setToolDetailRow] = useState<CloudChatTranscriptRowView | null>(null);
  const [permissionResolveError, setPermissionResolveError] = useState<string | null>(null);
  const [resolvingPermissionKey, setResolvingPermissionKey] = useState<string | null>(null);
  const autoOpenedPermissionIdsRef = useRef<Set<string>>(new Set());
  const dismissedPermissionIdsRef = useRef<Set<string>>(new Set());
  const toolDetailPermission = toolDetailRow?.sourceRequestId
    ? pendingPermissionByRequestId.get(toolDetailRow.sourceRequestId) ?? null
    : null;
  const latestPendingPermission = useMemo(
    () => [...pendingPermissionByRequestId.values()]
      .sort((left, right) => right.requestedSeq - left.requestedSeq)[0] ?? null,
    [pendingPermissionByRequestId],
  );

  useEffect(() => {
    if (!toolDetailRow) {
      return;
    }
    const latestRow = visibleTranscriptRows.find((row) => row.id === toolDetailRow.id);
    if (!latestRow) {
      return;
    }
    setToolDetailRow(latestRow);
  }, [toolDetailRow?.id, visibleTranscriptRows]);

  useEffect(() => {
    const pendingIds = new Set(pendingPermissionByRequestId.keys());
    for (const requestId of autoOpenedPermissionIdsRef.current) {
      if (!pendingIds.has(requestId)) {
        autoOpenedPermissionIdsRef.current.delete(requestId);
      }
    }
    for (const requestId of dismissedPermissionIdsRef.current) {
      if (!pendingIds.has(requestId)) {
        dismissedPermissionIdsRef.current.delete(requestId);
      }
    }
    const openRequestId = toolDetailRow?.sourceRequestId ?? null;
    if (!openRequestId || pendingIds.has(openRequestId)) {
      return;
    }
    if (autoOpenedPermissionIdsRef.current.has(openRequestId)) {
      setPermissionResolveError(null);
      setToolDetailRow(null);
    }
  }, [pendingPermissionByRequestId, toolDetailRow?.sourceRequestId]);

  useEffect(() => {
    if (!latestPendingPermission) {
      return;
    }
    const requestId = latestPendingPermission.requestId;
    if (
      toolDetailRow?.sourceRequestId === requestId
      || dismissedPermissionIdsRef.current.has(requestId)
    ) {
      return;
    }
    const permissionRow = visibleTranscriptRows.find((row) =>
      row.sourceRequestId === requestId
      && (row.kind === "tool" || row.kind === "tool_group")
    );
    if (!permissionRow) {
      return;
    }
    autoOpenedPermissionIdsRef.current.add(requestId);
    setPermissionResolveError(null);
    setToolDetailRow(permissionRow);
  }, [
    latestPendingPermission?.requestId,
    toolDetailRow?.sourceRequestId,
    visibleTranscriptRows,
  ]);

  function openToolDetailRow(row: CloudChatTranscriptRowView) {
    if (row.sourceRequestId) {
      dismissedPermissionIdsRef.current.delete(row.sourceRequestId);
    }
    setPermissionResolveError(null);
    setToolDetailRow(row);
  }

  function closeToolDetailSheet() {
    if (toolDetailPermission?.requestId) {
      dismissedPermissionIdsRef.current.add(toolDetailPermission.requestId);
    }
    setPermissionResolveError(null);
    setToolDetailRow(null);
  }

  function resetPermissionSheet() {
    setToolDetailRow(null);
    setPermissionResolveError(null);
    setResolvingPermissionKey(null);
    autoOpenedPermissionIdsRef.current.clear();
    dismissedPermissionIdsRef.current.clear();
  }

  return {
    toolDetailRow,
    toolDetailPermission,
    permissionResolveError,
    resolvingPermissionKey,
    setToolDetailRow,
    setPermissionResolveError,
    setResolvingPermissionKey,
    openToolDetailRow,
    closeToolDetailSheet,
    resetPermissionSheet,
  };
}
