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
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import {
  customIntegrationSubmitError,
  validateCustomIntegrationForm,
  type CustomIntegrationFormErrors,
  type CustomIntegrationFormInput,
} from "@/lib/domain/settings/org-integrations-presentation";

interface AddCustomIntegrationDialogProps {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  /** Resolves on success; a rejection surfaces inline as the submit error. */
  onSubmit: (input: CustomIntegrationFormInput) => Promise<void>;
}

/**
 * "Add custom MCP" form: display name, namespace, and MCP URL. Local
 * validation mirrors the server rules; API validation errors from the
 * create call are surfaced inline under the form.
 */
export function AddCustomIntegrationDialog({
  open,
  creating,
  onClose,
  onSubmit,
}: AddCustomIntegrationDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [namespace, setNamespace] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [fieldErrors, setFieldErrors] = useState<CustomIntegrationFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    setDisplayName("");
    setNamespace("");
    setMcpUrl("");
    setFieldErrors({});
    setSubmitError(null);
  }, [open]);

  async function handleSubmit() {
    if (creating) {
      return;
    }
    const input: CustomIntegrationFormInput = {
      displayName: displayName.trim(),
      namespace: namespace.trim(),
      mcpUrl: mcpUrl.trim(),
    };
    const errors = validateCustomIntegrationForm(input);
    setFieldErrors(errors ?? {});
    setSubmitError(null);
    if (errors) {
      return;
    }
    try {
      await onSubmit(input);
    } catch (error) {
      setSubmitError(customIntegrationSubmitError(error));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !creating) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add custom MCP integration</DialogTitle>
          <DialogDescription>
            Register an MCP server for your organization. Members can use its
            tools once the integration is enabled.
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div>
            <Label htmlFor="custom-integration-display-name">Display name</Label>
            <Input
              id="custom-integration-display-name"
              autoComplete="off"
              placeholder="Internal tools"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            {fieldErrors.displayName ? (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.displayName}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="custom-integration-namespace">Namespace</Label>
            <Input
              id="custom-integration-namespace"
              autoComplete="off"
              placeholder="internal-tools"
              value={namespace}
              onChange={(event) => setNamespace(event.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Prefixes the integration&apos;s tool names for agents.
            </p>
            {fieldErrors.namespace ? (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.namespace}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="custom-integration-mcp-url">MCP URL</Label>
            <Input
              id="custom-integration-mcp-url"
              autoComplete="off"
              placeholder="https://mcp.example.com/mcp"
              value={mcpUrl}
              onChange={(event) => setMcpUrl(event.target.value)}
            />
            {fieldErrors.mcpUrl ? (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.mcpUrl}</p>
            ) : null}
          </div>

          {submitError ? (
            <p className="text-xs text-destructive" role="alert">{submitError}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={creating} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={creating}>
              Add integration
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
