import { useState } from "react";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import type { PollSkippedField } from "@proliferate/product-domain/workflows/poll-setup";

export interface WorkflowPollInspectSubmit {
  url: string;
  authHeader: string | null;
  authValue: string | null;
}

/** The review shown after a successful probe: how many inputs were derived, and
 * which sample fields couldn't become inputs (mental-model §5 flow 1). */
export interface WorkflowPollInspectReview {
  derivedCount: number;
  skippedFields: PollSkippedField[];
}

export interface WorkflowPollInspectModalProps {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  /** Set once the probe succeeds — switches the modal to its review phase. */
  review?: WorkflowPollInspectReview | null;
  onClose: () => void;
  onSubmit: (input: WorkflowPollInspectSubmit) => void;
  /** Confirm the review and hand off into the editor. */
  onConfirm: () => void;
}

/**
 * Flow 1 entry point (workflow-from-poll, mental-model §5): "enter API key +
 * endpoint → we call `/init` → derive the starting inputs from the sample →
 * hard error on bad response." Two phases: the endpoint form, then a review that
 * shows how many inputs were derived and lists any sample fields that couldn't
 * become inputs (non-scalar arrays/objects/null) as a quiet informational note,
 * before handing off into the editor (track 1a′).
 */
export function WorkflowPollInspectModal({
  open,
  busy = false,
  error = null,
  review = null,
  onClose,
  onSubmit,
  onConfirm,
}: WorkflowPollInspectModalProps) {
  const [url, setUrl] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [authValue, setAuthValue] = useState("");

  const trimmedUrl = url.trim();
  const urlValid = trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://");
  const reviewing = review !== null;

  const handleSubmit = () => {
    if (!urlValid || busy) return;
    onSubmit({
      url: trimmedUrl,
      authHeader: authHeader.trim() || null,
      authValue: authValue || null,
    });
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Start a workflow from a poll feed"
      description="We'll probe the endpoint's /init path and seed a new workflow's inputs from the sample item it returns."
      sizeClassName="max-w-lg"
      footer={
        reviewing ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onConfirm} loading={busy}>
              Create workflow
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={busy} disabled={!urlValid}>
              Inspect
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">
            {error}
          </p>
        ) : null}

        {reviewing ? (
          <div className="flex flex-col gap-3">
            <p className="text-ui-sm text-muted-foreground">
              Derived {review.derivedCount} input{review.derivedCount === 1 ? "" : "s"} from the
              sample item. You can adjust them in the editor.
            </p>
            {review.skippedFields.length > 0 ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-border bg-foreground/[0.02] px-3 py-2.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {review.skippedFields.length} field
                  {review.skippedFields.length === 1 ? "" : "s"} couldn&apos;t become an input
                </p>
                <ul className="flex flex-col gap-1">
                  {review.skippedFields.map((field) => (
                    <li key={field.name} className="text-xs text-faint">
                      <code className="text-muted-foreground">{field.name}</code> — {field.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>Poll URL</Label>
              <Input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://issues.example.com/poll"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label>Auth header name</Label>
                <Input
                  value={authHeader}
                  onChange={(event) => setAuthHeader(event.target.value)}
                  placeholder="Authorization"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label>Auth header value</Label>
                <Input
                  type="password"
                  value={authValue}
                  onChange={(event) => setAuthValue(event.target.value)}
                  placeholder={authHeader.trim() ? "Header value" : "No auth header set"}
                  disabled={!authHeader.trim()}
                />
              </div>
            </div>

            <p className="text-xs text-faint">
              Only used once, to probe <code>/init</code> and derive the starting inputs — nothing is
              saved until you edit and save the new workflow.
            </p>
          </>
        )}
      </div>
    </ModalShell>
  );
}
