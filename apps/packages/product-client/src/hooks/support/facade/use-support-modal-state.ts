import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import type { DesktopDiagnosticsBridge } from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type {
  SupportReportAttachmentPayload,
  SupportReportJob,
  SupportReportSnapshotIntent,
} from "#product/lib/domain/support/report-types";
import { useSupportReportSnapshot } from "#product/hooks/support/derived/use-support-report-snapshot";
import { useSupportSnapshotConsent } from "#product/hooks/support/workflows/use-support-snapshot-consent";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import type { SupportModalKind } from "#product/stores/support/support-modal-store";
import { enqueueSupportReportJob } from "#product/lib/access/browser/support-report-job-events";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

export interface StagedAttachment extends SupportReportAttachmentPayload {
  id: string;
  /** Object URL for image preview thumbnails. */
  previewUrl?: string | null;
}

interface UseSupportModalStateOptions {
  kind: SupportModalKind;
  onClose: () => void;
}

export function useSupportModalState({ kind, onClose }: UseSupportModalStateOptions) {
  const diagnostics = useProductHost().desktop?.diagnostics ?? null;
  const snapshot = useSupportReportSnapshot({ source: "sidebar" });
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const [message, setMessage] = useState("");
  const [creditConsent, setCreditConsentRaw] = useState(false);
  const [creditName, setCreditName] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [notifyMe, setNotifyMe] = useState(false);
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);

  function setCreditConsent(next: boolean) {
    setCreditConsentRaw(next);
    if (!next) {
      setCreditName("");
    }
  }
  const [stagingError, setStagingError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const jobIdRef = useRef(crypto.randomUUID());
  const openedAtRef = useRef(new Date().toISOString());
  // Per-report snapshot consent. It starts unchecked on every open and stages
  // nothing until an explicit Send or Save a copy… while consent is true.
  const snapshotConsent = useSupportSnapshotConsent({
    clientJobId: jobIdRef.current,
    reportOpenedAt: openedAtRef.current,
  });

  // Record a local marker on mount so diagnostics can be bisected around the
  // report. The store stays pure state.
  useEffect(() => {
    recordRendererDiagnostic({
      name: "renderer.support.report_opened",
      severity: "info",
      kind: "milestone",
      privacy: "operational",
      fields: {
        kind: diagnosticField(kind, "operational"),
        job_id: diagnosticField(jobIdRef.current, "operational"),
      },
    });
  }, [kind]);

  const stageFiles = useCallback(async (files: FileList | File[]) => {
    const nextFiles = Array.from(files);
    if (nextFiles.length === 0) {
      return;
    }
    setStagingError(null);
    try {
      const staged = await Promise.all(
        nextFiles.map((file) => stageAttachment(file, diagnostics)),
      );
      setAttachments((current) => [...current, ...staged]);
    } catch (error) {
      setStagingError(error instanceof Error ? error.message : "Failed to add attachment.");
    }
  }, [diagnostics]);

  const handleAttachmentPaste = useCallback((event: ClipboardEvent<HTMLElement>) => {
    const files = extractAttachmentTransferFiles(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void stageFiles(files);
  }, [stageFiles]);

  const handleAttachmentDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isAttachmentFileTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleAttachmentDrop = useCallback((event: DragEvent<HTMLElement>) => {
    const files = extractAttachmentTransferFiles(event.dataTransfer);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void stageFiles(files);
  }, [stageFiles]);

  const handleAttachmentInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      void stageFiles(event.target.files);
    }
    event.currentTarget.value = "";
  }, [stageFiles]);

  function removeAttachment(attachment: StagedAttachment) {
    setAttachments((current) =>
      current.filter((candidate) => candidate.id !== attachment.id)
    );
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    if (attachment.stagedPath) {
      void diagnostics?.deleteAttachment(attachment.stagedPath);
    }
  }

  const canSend = (
    message.trim().length > 0
    || attachments.length > 0
  ) && !isSubmitting;

  async function handleSend() {
    if (!canSend || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);

    // Consent is read live at Send. A fatal preparation failure keeps the modal
    // open with the draft intact so the user can retry or clear the box and
    // send without a snapshot; intent is never downgraded silently.
    let supportSnapshot: SupportReportSnapshotIntent = { kind: "none" };
    const prepared = await snapshotConsent.prepare();
    if (prepared.state === "prepared") {
      supportSnapshot = prepared.intent;
    } else if (prepared.state !== "none") {
      submittingRef.current = false;
      setIsSubmitting(false);
      return;
    }

    // Determine scope: use active workspace if available, else app_only.
    const defaultWorkspaceId = snapshot.defaultWorkspaceId ?? null;
    const scopeKind = defaultWorkspaceId ? "most_recent_workspace" as const : "app_only" as const;
    const effectiveWorkspaceIds = defaultWorkspaceId ? [defaultWorkspaceId] : [];

    const job: SupportReportJob = {
      jobId: jobIdRef.current,
      createdAt: new Date().toISOString(),
      message: message.trim(),
      scope: {
        kind: scopeKind,
        workspaceIds: effectiveWorkspaceIds,
      },
      publicContentConsent: false,
      kind,
      creditConsent,
      creditName: creditConsent ? creditName.trim() || null : null,
      // `urgent` is a bug-only signal; prompt submissions never mark urgent.
      urgent: kind === "bug" ? urgent : false,
      notifyMe,
      // Immutable diagnostics intent. Without live consent it is explicitly
      // no-snapshot; with consent it carries the exact staged artifact the
      // consent epoch produced. The legacy includeLogs flag never grants it.
      supportSnapshot,
      snapshot: {
        ...snapshot,
        openedAt: openedAtRef.current,
      },
      attachments: attachments.map(({ id: _id, previewUrl: _preview, ...attachment }) => attachment),
      ...(defaultWorkspaceId ? { activeWorkspaceId: defaultWorkspaceId } : {}),
      ...(activeSessionId ? { activeSessionId } : {}),
      reportOpenedAt: openedAtRef.current,
    };

    try {
      // Enqueue in-process by dispatching a DOM event; the upload queue's
      // listener is the single owner of persistence + draining. Persisting
      // here too would make the listener's persist dedupe and silently skip
      // draining, so the report would never upload until the next app launch.
      void enqueueSupportReportJob(job);
      onClose();
    } catch (error) {
      submittingRef.current = false;
      setIsSubmitting(false);
      setStagingError(error instanceof Error ? error.message : "Failed to send report.");
    }
  }

  function handleCancel() {
    // Supersede the consent epoch so any in-flight preparation is cancelled and
    // a late result can never enqueue.
    snapshotConsent.cancel();
    // Clean up staged files.
    for (const attachment of attachments) {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      if (attachment.stagedPath) {
        void diagnostics?.deleteAttachment(attachment.stagedPath).catch(() => {});
      }
    }
    onClose();
  }

  return {
    attachments,
    canSend,
    creditConsent,
    creditName,
    handleAttachmentDragOver,
    handleAttachmentDrop,
    handleAttachmentInputChange,
    handleAttachmentPaste,
    handleCancel,
    handleSend,
    isSubmitting,
    message,
    removeAttachment,
    setCreditConsent,
    setCreditName,
    setMessage,
    setNotifyMe,
    setUrgent,
    notifyMe,
    snapshotConsent,
    urgent,
    stagingError,
  };
}

function scopeFallbackFileName(file: File): string {
  return file.name || fallbackAttachmentFileName(file.type);
}

async function stageAttachment(
  file: File,
  diagnostics: DesktopDiagnosticsBridge | null,
): Promise<StagedAttachment> {
  const dataBase64 = await fileToBase64(file);
  const id = crypto.randomUUID();
  const stagedPath = diagnostics
    ? await diagnostics.stageAttachment({
        clientFileId: id,
        fileName: scopeFallbackFileName(file),
        dataBase64,
      })
    : null;

  // Create preview URL for image types.
  let previewUrl: string | null = null;
  if (file.type.startsWith("image/")) {
    previewUrl = URL.createObjectURL(file);
  }

  return {
    id,
    clientFileId: id,
    fileName: scopeFallbackFileName(file),
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    ...(stagedPath ? { stagedPath } : { dataBase64, stagedPath: null }),
    previewUrl,
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

function extractAttachmentTransferFiles(transfer: DataTransfer): File[] {
  const files = Array.from(transfer.files);
  if (files.length > 0) {
    return files;
  }
  return Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function isAttachmentFileTransfer(transfer: DataTransfer): boolean {
  return transfer.files.length > 0
    || Array.from(transfer.items).some((item) => item.kind === "file")
    || Array.from(transfer.types).includes("Files");
}

function fallbackAttachmentFileName(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "screenshot.jpg";
    case "image/png":
      return "screenshot.png";
    case "image/webp":
      return "screenshot.webp";
    case "image/gif":
      return "screenshot.gif";
    case "image/tiff":
      return "screenshot.tiff";
    case "application/pdf":
      return "attachment.pdf";
    case "text/plain":
      return "attachment.txt";
    default:
      return "attachment";
  }
}
