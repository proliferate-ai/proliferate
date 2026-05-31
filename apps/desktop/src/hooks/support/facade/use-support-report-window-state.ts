import { useCallback, useEffect, useState } from "react";
import {
  closeSupportReportWindow,
  deleteStagedSupportReportAttachment,
  getSupportReportWindowSnapshot,
  listenSupportSnapshotUpdates,
  stageSupportReportAttachment,
  submitSupportReportJob,
} from "@/lib/access/tauri/support";
import type {
  SupportReportAttachmentPayload,
  SupportReportJob,
  SupportReportScopeKind,
  SupportReportWindowSnapshot,
  SupportReportWorkspaceOption,
} from "@/lib/domain/support/report-types";

export interface StagedSupportReportAttachment extends SupportReportAttachmentPayload {
  id: string;
}

export function useSupportReportWindowState() {
  const [snapshot, setSnapshot] = useState<SupportReportWindowSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<StagedSupportReportAttachment[]>([]);
  const [scopeKind, setScopeKind] = useState<SupportReportScopeKind>("app_only");
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [stagingError, setStagingError] = useState<string | null>(null);

  const applySnapshotDefaults = useCallback((nextSnapshot: SupportReportWindowSnapshot) => {
    setSnapshot(nextSnapshot);
    setScopeKind(nextSnapshot.defaultScope);
    setSelectedWorkspaceIds(nextSnapshot.defaultWorkspaceId ? [nextSnapshot.defaultWorkspaceId] : []);
  }, []);

  useEffect(() => {
    let disposed = false;
    void getSupportReportWindowSnapshot().then((loaded) => {
      if (!disposed && loaded) {
        applySnapshotDefaults(loaded);
      }
    });
    let unlisten: (() => void) | null = null;
    void listenSupportSnapshotUpdates((nextSnapshot) => {
      if (!disposed) {
        applySnapshotDefaults(nextSnapshot);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applySnapshotDefaults]);

  const stageFiles = useCallback(async (files: FileList | File[]) => {
    const nextFiles = Array.from(files);
    if (nextFiles.length === 0) {
      return;
    }
    setStagingError(null);
    try {
      const staged = await Promise.all(nextFiles.map(stageAttachment));
      setAttachments((current) => [...current, ...staged]);
    } catch (error) {
      setStagingError(error instanceof Error ? error.message : "Failed to add attachment.");
    }
  }, []);

  const defaultWorkspace = snapshot?.workspaceOptions.find((workspace) =>
    workspace.id === snapshot.defaultWorkspaceId
  ) ?? null;
  const effectiveWorkspaceIds = scopeKind === "app_only"
    ? []
    : scopeKind === "choose_workspace"
      ? selectedWorkspaceIds
      : defaultWorkspace ? [defaultWorkspace.id] : [];
  const workspaceSelectionRequired = scopeKind === "choose_workspace";
  const canSend = (
    message.trim().length > 0
    || attachments.length > 0
  ) && (
    (!workspaceSelectionRequired || effectiveWorkspaceIds.length > 0)
    && (scopeKind !== "most_recent_workspace" || effectiveWorkspaceIds.length > 0)
  );

  function setScope(kind: SupportReportScopeKind) {
    if (kind === "most_recent_workspace" && !snapshot?.defaultWorkspaceId) {
      return;
    }
    if (kind === "choose_workspace" && !snapshot?.workspaceOptions.length) {
      return;
    }
    setScopeKind(kind);
    if (kind === "app_only") {
      setSelectedWorkspaceIds([]);
      return;
    }
    if (selectedWorkspaceIds.length === 0 && snapshot?.defaultWorkspaceId) {
      setSelectedWorkspaceIds([snapshot.defaultWorkspaceId]);
    }
  }

  function toggleWorkspace(workspaceId: string) {
    setSelectedWorkspaceIds((current) => {
      return current.includes(workspaceId)
        ? current.filter((id) => id !== workspaceId)
        : [...current, workspaceId];
    });
  }

  function removeAttachment(attachment: StagedSupportReportAttachment) {
    setAttachments((current) =>
      current.filter((candidate) => candidate.id !== attachment.id)
    );
    if (attachment.stagedPath) {
      void deleteStagedSupportReportAttachment(attachment.stagedPath);
    }
  }

  async function handleCancel() {
    await Promise.all(attachments.map(async (attachment) => {
      if (attachment.stagedPath) {
        await deleteStagedSupportReportAttachment(attachment.stagedPath).catch(() => {});
      }
    }));
    await closeSupportReportWindow();
  }

  async function handleSend() {
    if (!snapshot || !canSend) {
      return;
    }
    const job: SupportReportJob = {
      jobId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      message: message.trim(),
      scope: {
        kind: scopeKind,
        workspaceIds: effectiveWorkspaceIds,
      },
      snapshot,
      attachments: attachments.map(({ id: _id, ...attachment }) => attachment),
    };
    await submitSupportReportJob(job);
    await closeSupportReportWindow();
  }

  return {
    attachments,
    canSend,
    defaultWorkspace,
    handleCancel,
    handleSend,
    message,
    removeAttachment,
    scopeKind,
    selectedWorkspaceIds,
    setMessage,
    setScope,
    snapshot,
    stageFiles,
    stagingError,
    toggleWorkspace,
  };
}

function scopeFallbackFileName(file: File): string {
  return file.name || "attachment";
}

async function stageAttachment(file: File): Promise<StagedSupportReportAttachment> {
  const dataBase64 = await fileToBase64(file);
  const id = crypto.randomUUID();
  const stagedPath = await stageSupportReportAttachment({
    clientFileId: id,
    fileName: scopeFallbackFileName(file),
    dataBase64,
  });
  return {
    id,
    clientFileId: id,
    fileName: scopeFallbackFileName(file),
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    dataBase64: stagedPath ? undefined : dataBase64,
    stagedPath,
  };
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
  return dataUrl.split(",", 2)[1] ?? "";
}

export type SupportReportWindowDefaultWorkspace = SupportReportWorkspaceOption | null;
