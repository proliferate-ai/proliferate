import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@proliferate/ui/kit/Dialog";
import { Button } from "@proliferate/ui/primitives/Button";
import { Label } from "@proliferate/ui/primitives/Label";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import type { FunctionInvocation } from "@proliferate/cloud-sdk/client/integrations";
import { integrationApiErrorMessage } from "@/hooks/access/cloud/integrations/use-admin-integration-definitions";

interface RotateFunctionInvocationHeadersDialogProps {
  invocation: FunctionInvocation | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (headers: Record<string, string> | null) => Promise<void>;
}

/**
 * Headers are WRITE-ONLY (D4 posture): this dialog never shows the current
 * value — only whether one is set (``hasHeaders``, shown on the row) — and
 * every submit here fully replaces the stored ciphertext (set or rotate).
 */
export function RotateFunctionInvocationHeadersDialog({
  invocation,
  saving,
  onClose,
  onSubmit,
}: RotateFunctionInvocationHeadersDialogProps) {
  const [headersText, setHeadersText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (invocation) {
      setHeadersText("");
      setError(null);
    }
  }, [invocation]);

  function parseHeaders(): Record<string, string> | undefined {
    const trimmed = headersText.trim();
    if (!trimmed) {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.some(([, value]) => typeof value !== "string")) {
      return undefined;
    }
    return Object.fromEntries(entries) as Record<string, string>;
  }

  async function handleSave() {
    if (saving) {
      return;
    }
    const headers = parseHeaders();
    if (headers === undefined) {
      setError("Headers must be a flat JSON object of string values.");
      return;
    }
    setError(null);
    try {
      await onSubmit(Object.keys(headers).length > 0 ? headers : null);
    } catch (submitError) {
      setError(integrationApiErrorMessage(submitError) ?? "Headers could not be saved.");
    }
  }

  async function handleClear() {
    if (saving) {
      return;
    }
    setError(null);
    try {
      await onSubmit(null);
    } catch (submitError) {
      setError(integrationApiErrorMessage(submitError) ?? "Headers could not be cleared.");
    }
  }

  return (
    <Dialog
      open={invocation !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{invocation ? `Headers for ${invocation.name}` : "Headers"}</DialogTitle>
          <DialogDescription>
            {invocation?.hasHeaders
              ? "Headers are set (•••• set) and never shown again. Entering new headers replaces them."
              : "No headers are set. Add request headers this function sends, such as an API key."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-2">
          <Label htmlFor="function-invocation-headers">New headers (JSON object)</Label>
          <Textarea
            id="function-invocation-headers"
            variant="code"
            rows={5}
            placeholder='{\n  "Authorization": "Bearer sk-..."\n}'
            value={headersText}
            onChange={(event) => setHeadersText(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Save is disabled while this is blank — use Clear headers to remove them instead.
          </p>
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </div>

        <DialogFooter>
          {invocation?.hasHeaders ? (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => void handleClear()}>
              Clear headers
            </Button>
          ) : null}
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={saving}
            disabled={headersText.trim().length === 0}
            onClick={() => void handleSave()}
          >
            Save headers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
