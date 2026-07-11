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
import { Select } from "@proliferate/ui/primitives/Select";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import type { FunctionInvocation } from "@proliferate/cloud-sdk/client/integrations";
import {
  FUNCTION_INVOCATION_METHODS,
  functionInvocationSubmitError,
  parseFunctionInvocationArgsSchema,
  validateFunctionInvocationForm,
  type FunctionInvocationFormErrors,
  type FunctionInvocationFormInput,
} from "@/lib/domain/settings/function-invocations-presentation";
import { integrationApiErrorMessage } from "@/hooks/access/cloud/integrations/use-admin-integration-definitions";

export interface FunctionInvocationSubmitInput {
  name: string;
  displayName: string | null;
  description: string | null;
  endpointUrl: string;
  method: string;
  argsSchema: Record<string, unknown>;
}

interface FunctionInvocationFormDialogProps {
  open: boolean;
  /** ``null`` = create; otherwise the invocation being edited (name is fixed). */
  editing: FunctionInvocation | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: FunctionInvocationSubmitInput) => Promise<void>;
}

const EMPTY_FORM: FunctionInvocationFormInput = {
  name: "",
  displayName: "",
  description: "",
  endpointUrl: "",
  method: "post",
  argsSchemaText: "",
};

/**
 * Create/edit form: name/endpoint/method/args-schema. Headers are handled by
 * a dedicated rotate dialog (write-only, set/rotate — never shown or edited
 * here), and the chat-enable toggle lives on the row, not the form.
 */
export function FunctionInvocationFormDialog({
  open,
  editing,
  saving,
  onClose,
  onSubmit,
}: FunctionInvocationFormDialogProps) {
  const [form, setForm] = useState<FunctionInvocationFormInput>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FunctionInvocationFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(
      editing
        ? {
            name: editing.name,
            displayName: editing.displayName ?? "",
            description: editing.description ?? "",
            endpointUrl: editing.endpointUrl,
            method: editing.method,
            argsSchemaText: JSON.stringify(editing.argsSchema, null, 2),
          }
        : EMPTY_FORM,
    );
    setFieldErrors({});
    setSubmitError(null);
  }, [open, editing]);

  async function handleSubmit() {
    if (saving) {
      return;
    }
    const errors = validateFunctionInvocationForm(form);
    setFieldErrors(errors ?? {});
    setSubmitError(null);
    if (errors) {
      return;
    }
    try {
      await onSubmit({
        name: form.name.trim(),
        displayName: form.displayName.trim() || null,
        description: form.description.trim() || null,
        endpointUrl: form.endpointUrl.trim(),
        method: form.method.trim().toLowerCase(),
        argsSchema: parseFunctionInvocationArgsSchema(form.argsSchemaText),
      });
    } catch (error) {
      setSubmitError(functionInvocationSubmitError(integrationApiErrorMessage(error)));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit function" : "New function"}</DialogTitle>
          <DialogDescription>
            A function is an HTTP request your agents can call by name. Workflows
            can always call it explicitly; enable it for chat separately.
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div>
            <Label htmlFor="function-invocation-name">Name</Label>
            <Input
              id="function-invocation-name"
              autoComplete="off"
              placeholder="lookup_order"
              value={form.name}
              disabled={Boolean(editing)}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The name your agents call — fixed after the function is created.
            </p>
            {fieldErrors.name ? <p className="mt-1 text-xs text-destructive">{fieldErrors.name}</p> : null}
          </div>

          <div>
            <Label htmlFor="function-invocation-display-name">Display name</Label>
            <Input
              id="function-invocation-display-name"
              autoComplete="off"
              placeholder="Look up order"
              value={form.displayName}
              onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
            />
          </div>

          <div>
            <Label htmlFor="function-invocation-description">Description</Label>
            <Textarea
              id="function-invocation-description"
              rows={2}
              placeholder="Looks up an order by id."
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </div>

          <div className="grid grid-cols-[1fr_10rem] gap-3">
            <div>
              <Label htmlFor="function-invocation-endpoint-url">Endpoint URL</Label>
              <Input
                id="function-invocation-endpoint-url"
                autoComplete="off"
                placeholder="https://api.example.com/orders/lookup"
                value={form.endpointUrl}
                onChange={(event) => setForm((prev) => ({ ...prev, endpointUrl: event.target.value }))}
              />
              {fieldErrors.endpointUrl ? (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.endpointUrl}</p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="function-invocation-method">Method</Label>
              <Select
                id="function-invocation-method"
                value={form.method}
                onChange={(event) => setForm((prev) => ({ ...prev, method: event.target.value }))}
              >
                {FUNCTION_INVOCATION_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method.toUpperCase()}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="function-invocation-args-schema">Args schema (JSON Schema)</Label>
            <Textarea
              id="function-invocation-args-schema"
              variant="code"
              rows={6}
              placeholder={'{\n  "type": "object",\n  "properties": {\n    "id": { "type": "string" }\n  }\n}'}
              value={form.argsSchemaText}
              onChange={(event) => setForm((prev) => ({ ...prev, argsSchemaText: event.target.value }))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Validates the agent&apos;s call before it's sent. Leave blank for no
              argument validation.
            </p>
            {fieldErrors.argsSchemaText ? (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.argsSchemaText}</p>
            ) : null}
          </div>

          {submitError ? (
            <p className="text-xs text-destructive" role="alert">{submitError}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save changes" : "Create function"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
