import { useRef } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { CloudUpload, FileText, Folder, LifeBuoy, X } from "@proliferate/ui/icons";
import {
  useSupportReportWindowState,
  type SupportReportWindowDefaultWorkspace,
} from "@/hooks/support/facade/use-support-report-window-state";
import type { SupportReportScopeKind } from "@/lib/domain/support/report-types";

const SCOPE_OPTIONS: Array<{
  kind: SupportReportScopeKind;
  label: string;
}> = [
  { kind: "most_recent_workspace", label: "Most recent workspace" },
  { kind: "choose_workspace", label: "Choose workspace" },
  { kind: "app_only", label: "App only" },
];

export function SupportReportWindow() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    attachments,
    canSend,
    defaultWorkspace,
    handleAttachmentDragOver,
    handleAttachmentDrop,
    handleAttachmentInputChange,
    handleAttachmentPaste,
    handleCancel,
    handleSend,
    isSubmitting,
    message,
    publicContentConsent,
    removeAttachment,
    scopeKind,
    selectedWorkspaceIds,
    setMessage,
    setPublicContentConsent,
    setScope,
    snapshot,
    stagingError,
    toggleWorkspace,
  } = useSupportReportWindowState();

  return (
    <main
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-popover/95 text-popover-foreground shadow-floating backdrop-blur-lg"
      onPaste={handleAttachmentPaste}
      onDragOver={handleAttachmentDragOver}
      onDrop={handleAttachmentDrop}
    >
      <div className="shrink-0 border-b border-popover-ring/70 px-4 py-3" data-tauri-drag-region="true">
        <div className="flex items-center gap-2">
          <LifeBuoy className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold leading-6">Report issue</h1>
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
              variant="code"
              autoFocus
              data-telemetry-mask
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Tell us what went wrong."
              className="min-h-[132px]"
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
              className="flex min-h-[88px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-surface-control/80 px-4 py-4 text-center text-xs text-muted-foreground transition-colors hover:border-ring hover:bg-popover-accent hover:text-popover-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <CloudUpload className="mb-2 size-5" />
              <span>Drop screenshots or files here</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleAttachmentInputChange}
            />
            {stagingError ? (
              <p className="text-xs leading-5 text-destructive">{stagingError}</p>
            ) : null}
            {attachments.length > 0 ? (
              <div className="space-y-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex min-h-10 items-center gap-3 rounded-lg border border-border/70 bg-surface-control/70 px-3 py-2 text-xs"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium leading-5">{attachment.fileName}</div>
                      <div className="text-[11px] leading-4 text-muted-foreground">
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
                    className={`flex min-h-10 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-xs transition-colors ${
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
                      <span className="block font-medium leading-5">{option.label}</span>
                      {description ? (
                        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
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
                    className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-popover-accent"
                  >
                    <input
                      type="checkbox"
                      name="support-workspace"
                      checked={selectedWorkspaceIds.includes(workspace.id)}
                      onChange={() => toggleWorkspace(workspace.id)}
                    />
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium leading-5">{workspace.label}</span>
                      <span className="block truncate text-[11px] leading-4 text-muted-foreground">
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

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-surface-control/60 px-3 py-2 text-xs">
            <Checkbox
              checked={publicContentConsent}
              onChange={(event) => setPublicContentConsent(event.currentTarget.checked)}
              className="mt-1"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium leading-5">
                Include my message in the public issue
              </span>
              <span className="block text-[11px] leading-4 text-muted-foreground">
                Your message may appear on GitHub. Do not include secrets or API keys.
                Diagnostics and files stay private.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-popover-ring/70 px-4 py-3">
        <Button type="button" variant="ghost" onClick={() => { void handleCancel(); }}>
          Cancel
        </Button>
        <Button type="button" disabled={!canSend} loading={isSubmitting} onClick={() => { void handleSend(); }}>
          Send
        </Button>
      </div>
    </main>
  );
}

function scopeDescription(
  kind: SupportReportScopeKind,
  defaultWorkspace: SupportReportWindowDefaultWorkspace,
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
