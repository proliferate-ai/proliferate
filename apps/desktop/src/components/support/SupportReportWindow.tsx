import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { CloudUpload, FileText, Folder, LifeBuoy, X } from "@proliferate/ui/icons";
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
} from "@/lib/domain/support/report-types";

interface StagedAttachment extends SupportReportAttachmentPayload {
  id: string;
}

const SCOPE_OPTIONS: Array<{
  kind: SupportReportScopeKind;
  label: string;
}> = [
  { kind: "most_recent_workspace", label: "Most recent workspace" },
  { kind: "choose_workspace", label: "Choose workspace" },
  { kind: "app_only", label: "App only" },
];

export function SupportReportWindow() {
  const [snapshot, setSnapshot] = useState<SupportReportWindowSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [scopeKind, setScopeKind] = useState<SupportReportScopeKind>("app_only");
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [stagingError, setStagingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  function removeAttachment(attachment: StagedAttachment) {
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

  return (
    <main
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-popover/95 text-popover-foreground shadow-floating backdrop-blur-lg"
      onPaste={(event) => {
        if (event.clipboardData.files.length > 0) {
          void stageFiles(event.clipboardData.files);
        }
      }}
    >
      <div className="shrink-0 border-b border-popover-ring/70 px-4 py-3" data-tauri-drag-region="true">
        <div className="flex items-center gap-2">
          <LifeBuoy className="size-4 text-muted-foreground" />
          <h1 className="text-base font-semibold leading-6">Report issue</h1>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          <section className="space-y-2">
            <label htmlFor="support-message" className="text-sm font-medium">
              What happened?
            </label>
            <Textarea
              id="support-message"
              autoFocus
              data-telemetry-mask
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Tell us what went wrong."
              className="min-h-[132px] resize-y bg-surface-control"
            />
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">Attachments</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <CloudUpload className="size-3.5" />
                Add files
              </Button>
            </div>
            <button
              type="button"
              className="flex min-h-[88px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-surface-control/80 px-4 py-4 text-center text-sm text-muted-foreground transition-colors hover:border-ring hover:bg-popover-accent hover:text-popover-foreground"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                void stageFiles(event.dataTransfer.files);
              }}
            >
              <CloudUpload className="mb-2 size-5" />
              <span>Drop screenshots or files here</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) {
                  void stageFiles(event.target.files);
                }
                event.currentTarget.value = "";
              }}
            />
            {stagingError ? (
              <p className="text-xs leading-5 text-destructive">{stagingError}</p>
            ) : null}
            {attachments.length > 0 ? (
              <div className="space-y-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex min-h-10 items-center gap-3 rounded-lg border border-border/70 bg-surface-control/70 px-3 py-2 text-sm"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{attachment.fileName}</div>
                      <div className="text-xs text-muted-foreground">
                        {attachment.contentType || "file"} · {formatBytes(attachment.sizeBytes)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${attachment.fileName}`}
                      onClick={() => removeAttachment(attachment)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium">Include diagnostics from</h2>
            <div className="grid gap-2">
              {SCOPE_OPTIONS.map((option) => {
                const disabled = (
                  (option.kind === "most_recent_workspace" && !defaultWorkspace)
                  || (option.kind === "choose_workspace" && !snapshot?.workspaceOptions.length)
                );
                const description = scopeDescription(option.kind, defaultWorkspace);
                return (
                  <label
                    key={option.kind}
                    className={`flex min-h-10 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      scopeKind === option.kind
                        ? "border-ring bg-popover-accent text-popover-foreground"
                        : "border-border/70 bg-surface-control/60 hover:bg-popover-accent"
                    } ${disabled ? "cursor-not-allowed opacity-50 hover:bg-surface-control/60" : ""}`}
                  >
                    <input
                      type="radio"
                      name="support-scope"
                      disabled={disabled}
                      checked={scopeKind === option.kind}
                      onChange={() => setScope(option.kind)}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{option.label}</span>
                      {description ? (
                        <span className="block truncate text-xs leading-4 text-muted-foreground">
                          {description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>

            {scopeKind === "choose_workspace" && snapshot?.workspaceOptions.length ? (
              <div className="space-y-1 rounded-xl border border-border/70 bg-popover p-1 shadow-popover">
                {snapshot.workspaceOptions.map((workspace) => (
                  <label
                    key={workspace.id}
                    className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-popover-accent"
                  >
                    <input
                      type="checkbox"
                      name="support-workspace"
                      checked={selectedWorkspaceIds.includes(workspace.id)}
                      onChange={() => toggleWorkspace(workspace.id)}
                    />
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{workspace.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[workspace.location, workspace.branch, workspace.status]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-popover-ring/70 px-4 py-3">
        <Button type="button" variant="ghost" onClick={() => { void handleCancel(); }}>
          Cancel
        </Button>
        <Button type="button" disabled={!canSend} onClick={() => { void handleSend(); }}>
          Send
        </Button>
      </div>
    </main>
  );
}

function scopeDescription(
  kind: SupportReportScopeKind,
  defaultWorkspace: SupportReportWindowSnapshot["workspaceOptions"][number] | null,
): string {
  if (kind === "most_recent_workspace") {
    return defaultWorkspace
      ? `Using ${defaultWorkspace.label}`
      : "No workspace available";
  }
  if (kind === "choose_workspace") {
    return "Pick specific workspaces";
  }
  return "No workspace activity";
}

async function stageAttachment(file: File): Promise<StagedAttachment> {
  const dataBase64 = await fileToBase64(file);
  const id = crypto.randomUUID();
  const stagedPath = await stageSupportReportAttachment({
    clientFileId: id,
    fileName: file.name || "attachment",
    dataBase64,
  });
  return {
    id,
    clientFileId: id,
    fileName: file.name || "attachment",
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

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}
